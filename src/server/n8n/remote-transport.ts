import 'server-only';

import { dispatchAcknowledgementSchema } from '@/contracts';

import type { DispatchOutcome, DispatchRequest, N8nTransport } from './transport';

export const DISPATCH_ACK_TIMEOUT_MS = 10_000;
const MAX_ACK_BYTES = 64 * 1024;

// Production webhook paths of the Command Center-facing workflows (refactor plan).
export const WEBHOOK_PATHS: Record<DispatchRequest['contract'], string> = {
  'ujh.analyze.v1': '/webhook/ujh-cc/analyze',
  'ujh.generate_proposal.v1': '/webhook/ujh-cc/generate-proposal'
};

// The request never reached n8n, so sending it again cannot start a second execution.
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const RETRYABLE_STATUSES = new Set([502, 503]);

export interface RemoteTransportOptions {
  baseUrl: string;
  webhookToken: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

type AttemptResult =
  | { kind: 'outcome'; outcome: DispatchOutcome }
  | { kind: 'retryable'; reason: string };

export function createRemoteTransport(options: RemoteTransportOptions): N8nTransport {
  const timeoutMs = options.timeoutMs ?? DISPATCH_ACK_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function attempt(request: DispatchRequest): Promise<AttemptResult> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${WEBHOOK_PATHS[request.contract]}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ujh-token': options.webhookToken },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
        cache: 'no-store'
      });
    } catch (error) {
      const code = errorCode(error);
      if (code && NOT_SENT_CODES.has(code)) return { kind: 'retryable', reason: code };
      // Timeout, reset, or unknown: the request may have reached n8n.
      return { kind: 'outcome', outcome: { type: 'ambiguous', reason: code ?? 'request_failed' } };
    }

    if (RETRYABLE_STATUSES.has(response.status)) {
      await response.body?.cancel();
      return { kind: 'retryable', reason: `http_${response.status}` };
    }

    const body = await readJson(response);
    if (response.ok) {
      const ack = dispatchAcknowledgementSchema.safeParse(body);
      if (ack.success && ack.data.accepted) {
        if (ack.data.run_id !== request.run_id) {
          return { kind: 'outcome', outcome: { type: 'ambiguous', reason: 'ack_run_id_mismatch' } };
        }
        return {
          kind: 'outcome',
          outcome: { type: 'accepted', executionRef: ack.data.execution_ref }
        };
      }
      return { kind: 'outcome', outcome: { type: 'ambiguous', reason: 'invalid_ack' } };
    }

    if (response.status === 400) {
      const ack = dispatchAcknowledgementSchema.safeParse(body);
      const message =
        ack.success && !ack.data.accepted ? ack.data.error.message : 'n8n rejected the request';
      return { kind: 'outcome', outcome: { type: 'rejected', code: 'INVALID_INPUT', message } };
    }

    if (response.status >= 400 && response.status < 500) {
      // Auth, missing webhook, or method errors: the workflow did not start.
      return {
        kind: 'outcome',
        outcome: {
          type: 'rejected',
          code: 'UPSTREAM_UNAVAILABLE',
          message: `n8n refused the dispatch (HTTP ${response.status})`
        }
      };
    }

    // 500, 504, and others: the workflow may have started before failing or timing out.
    return { kind: 'outcome', outcome: { type: 'ambiguous', reason: `http_${response.status}` } };
  }

  return {
    async dispatch(request) {
      const first = await attempt(request);
      if (first.kind === 'outcome') return first.outcome;
      const second = await attempt(request);
      if (second.kind === 'outcome') return second.outcome;
      return {
        type: 'rejected',
        code: 'UPSTREAM_UNAVAILABLE',
        message: `n8n is unavailable (${second.reason})`
      };
    }
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.length > MAX_ACK_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | null {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}
