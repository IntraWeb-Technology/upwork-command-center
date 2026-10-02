import 'server-only';

import type { z } from 'zod';

import {
  analyzeRequestSchema,
  generateProposalRequestSchema,
  type AnalyzeRequest,
  type GenerateProposalRequest
} from '@/contracts';
import type { Database } from '@/server/db/client';
import type { DispatchOutcome, DispatchRequest, N8nTransport } from '@/server/n8n/transport';

import { generateCallbackToken } from './callback-token';
import { uuidv7 } from './ids';
import { reportRunError, reportRunWarning } from './observability';
import {
  createWorkflowRun,
  getWorkflowRun,
  markDispatchAccepted,
  markDispatchRejected
} from './repository';
import {
  summarizeAnalyzeRequest,
  summarizeGenerateProposalRequest,
  type RequestSummary
} from './request-summary';
import type { WorkflowRun } from './types';

type EnvelopeFields = 'contract' | 'run_id' | 'requested_at' | 'callback';

export type DispatchInput =
  | { contract: 'ujh.analyze.v1'; payload: Omit<AnalyzeRequest, EnvelopeFields> }
  | {
      contract: 'ujh.generate_proposal.v1';
      payload: Omit<GenerateProposalRequest, EnvelopeFields>;
    };

export interface DispatchDeps {
  db: Database;
  transport: N8nTransport;
  /** Public URL of POST /api/integrations/n8n/callback. */
  callbackUrl: string;
  now?: () => Date;
}

export interface DispatchResult {
  run: WorkflowRun;
  outcome: DispatchOutcome;
}

export class InvalidRunRequestError extends Error {
  constructor(readonly paths: string[]) {
    super(`Invalid workflow request at: ${paths.join(', ') || '(root)'}`);
    this.name = 'InvalidRunRequestError';
  }
}

/**
 * Validate, persist intent, dispatch. The queued run (with its token digest and deadline)
 * is committed before n8n is called, so an early callback always finds it.
 */
export async function dispatchWorkflowRun(
  deps: DispatchDeps,
  input: DispatchInput,
  options: { deadlineMs?: number } = {}
): Promise<DispatchResult> {
  const now = deps.now?.() ?? new Date();
  const runId = uuidv7(now);
  const callbackToken = generateCallbackToken();
  const envelope = {
    run_id: runId,
    requested_at: now.toISOString(),
    callback: { url: deps.callbackUrl, token: callbackToken }
  };

  let request: DispatchRequest;
  let summary: RequestSummary;
  if (input.contract === 'ujh.analyze.v1') {
    const parsed = parseOrThrow(analyzeRequestSchema, {
      contract: input.contract,
      ...envelope,
      ...input.payload
    });
    request = parsed;
    summary = summarizeAnalyzeRequest(parsed);
  } else {
    const parsed = parseOrThrow(generateProposalRequestSchema, {
      contract: input.contract,
      ...envelope,
      ...input.payload
    });
    request = parsed;
    summary = summarizeGenerateProposalRequest(parsed);
  }

  await createWorkflowRun(deps.db, {
    id: runId,
    callbackToken,
    contract: input.contract,
    request: summary,
    now,
    deadlineMs: options.deadlineMs
  });

  const context = { runId, contract: input.contract };
  let outcome: DispatchOutcome;
  try {
    outcome = await deps.transport.dispatch(request);
  } catch (error) {
    // A transport that throws gives no proof n8n did not receive the request.
    reportRunError('dispatch_transport_threw', error, context);
    outcome = { type: 'ambiguous', reason: 'transport_error' };
  }

  const settledAt = deps.now?.() ?? new Date();
  if (outcome.type === 'accepted') {
    await markDispatchAccepted(deps.db, runId, {
      executionRef: outcome.executionRef,
      now: settledAt
    });
  } else if (outcome.type === 'rejected') {
    await markDispatchRejected(
      deps.db,
      runId,
      {
        code: outcome.code,
        stage: 'dispatch',
        message: outcome.message,
        retryable: outcome.code !== 'INVALID_INPUT'
      },
      settledAt
    );
    reportRunWarning('dispatch_rejected', context);
  } else {
    reportRunWarning('dispatch_ambiguous', context);
  }

  const run = await getWorkflowRun(deps.db, runId);
  if (!run) throw new Error('workflow run disappeared after dispatch');
  return { run, outcome };
}

function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InvalidRunRequestError([
      ...new Set(result.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)'))
    ]);
  }
  return result.data;
}
