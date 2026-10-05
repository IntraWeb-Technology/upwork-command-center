import 'server-only';

import type { Database } from '@/server/db/client';
import { processCallback, type MaterializeCallback } from '@/server/runs/callback';
import { isUuid } from '@/server/runs/ids';
import { reportRunError, reportRunWarning } from '@/server/runs/observability';
import { safeEqual } from '@/server/security/safe-equal';

export const MAX_CALLBACK_BYTES = 512 * 1024;

export interface CallbackHandlerDeps {
  getDb: () => Database;
  /** Shared N8N_CALLBACK_TOKEN; undefined means callbacks are not configured. */
  callbackToken: string | undefined;
  now?: () => Date;
  materialize?: MaterializeCallback;
}

// Response bodies are deliberately generic: no run state, schema details, or echoes.
function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'www-authenticate': 'Bearer'
    }
  });
const tooLarge = () => json(413, { error: 'payload_too_large' });
const badRequest = () => json(400, { error: 'invalid_payload' });

let warnedMissingToken = false;

export async function handleN8nCallback(
  request: Request,
  deps: CallbackHandlerDeps
): Promise<Response> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return badRequest();
    if (Number(declaredLength) > MAX_CALLBACK_BYTES) return tooLarge();
  }

  if (!deps.callbackToken) {
    if (!warnedMissingToken) {
      warnedMissingToken = true;
      console.error('[n8n-callback] N8N_CALLBACK_TOKEN is not configured; rejecting callbacks');
    }
    return unauthorized();
  }
  const authorization = request.headers.get('authorization') ?? '';
  const presented = /^Bearer (.+)$/.exec(authorization)?.[1] ?? '';
  if (!safeEqual(presented, deps.callbackToken)) return unauthorized();

  let text: string | null;
  try {
    text = await readBodyWithLimit(request, MAX_CALLBACK_BYTES);
  } catch {
    return badRequest();
  }
  if (text === null) return tooLarge();

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return badRequest();
  }

  try {
    const outcome = await processCallback(deps.getDb(), payload, {
      now: deps.now?.(),
      materialize: deps.materialize
    });
    switch (outcome.type) {
      case 'malformed':
        return badRequest();
      case 'forbidden':
        return json(403, { error: 'forbidden' });
      case 'invalid':
        reportRunWarning('callback_invalid', { runId: outcome.runId, contract: outcome.contract });
        return badRequest();
      case 'duplicate':
        return json(200, { ok: true, duplicate: true });
      case 'processed':
        return json(200, { ok: true });
    }
  } catch (error) {
    reportRunError('callback_processing_failed', error, describeRun(payload));
    return json(500, { error: 'internal_error' });
  }
}

/** Reads the body as UTF-8, returning null as soon as it exceeds the limit. */
async function readBodyWithLimit(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function describeRun(payload: unknown): { runId: string | null; contract: string | null } {
  if (typeof payload !== 'object' || payload === null) return { runId: null, contract: null };
  const { run_id: runId, contract } = payload as Record<string, unknown>;
  return {
    runId: typeof runId === 'string' && isUuid(runId) ? runId : null,
    contract: typeof contract === 'string' && contract.length <= 100 ? contract : null
  };
}
