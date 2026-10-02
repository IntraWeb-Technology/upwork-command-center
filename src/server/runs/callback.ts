import 'server-only';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { callbackEnvelopeSchema, type CallbackEnvelope } from '@/contracts';
import type { Database, Transaction } from '@/server/db/client';
import { workflowRuns } from '@/server/db/schema';

import { callbackTokenMatches, hashCallbackToken } from './callback-token';
import { isUuid } from './ids';
import { toWorkflowRun } from './repository';
import {
  isTerminal,
  type PersistedRunStatus,
  type WorkflowContract,
  type WorkflowRun
} from './types';

/**
 * Persists domain records for a callback inside the same transaction as the status change.
 * Throwing rolls back the whole transition. Future slices (analysis, proposal) plug in here.
 */
export type MaterializeCallback = (
  tx: Transaction,
  run: WorkflowRun,
  callback: CallbackEnvelope
) => Promise<void>;

export type CallbackOutcome =
  | { type: 'malformed' }
  | { type: 'forbidden' }
  | { type: 'duplicate'; runId: string; contract: WorkflowContract; status: PersistedRunStatus }
  | { type: 'invalid'; runId: string; contract: WorkflowContract }
  | {
      type: 'processed';
      runId: string;
      contract: WorkflowContract;
      status: 'succeeded' | 'failed';
    };

// Only what is needed to find and authenticate the run; full validation happens after.
const callbackHeadSchema = z.object({
  run_id: z.string().max(128),
  callback_token: z.string().max(512),
  contract: z.string().max(100)
});

// Compared against when the run is unknown, so both paths do the same hashing work.
const UNKNOWN_RUN_HASH = hashCallbackToken('unknown-run-placeholder');

export interface ProcessCallbackOptions {
  now?: Date;
  materialize?: MaterializeCallback;
}

export async function processCallback(
  db: Database,
  payload: unknown,
  { now = new Date(), materialize }: ProcessCallbackOptions = {}
): Promise<CallbackOutcome> {
  const head = callbackHeadSchema.safeParse(payload);
  if (!head.success) return { type: 'malformed' };
  const { run_id: runId, callback_token: presentedToken } = head.data;

  if (!isUuid(runId)) {
    callbackTokenMatches(presentedToken, UNKNOWN_RUN_HASH);
    return { type: 'forbidden' };
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .for('update');

    const tokenOk = callbackTokenMatches(
      presentedToken,
      row?.callbackTokenHash ?? UNKNOWN_RUN_HASH
    );
    if (!row || !tokenOk) return { type: 'forbidden' };

    const run = toWorkflowRun(row);
    if (isTerminal(run.status)) {
      return { type: 'duplicate', runId, contract: run.contract, status: run.status };
    }

    const parsed = callbackEnvelopeSchema.safeParse(payload);
    if (head.data.contract !== run.contract || !parsed.success) {
      const message =
        head.data.contract !== run.contract
          ? 'Callback contract does not match the run contract'
          : describeIssues(parsed.error);
      await tx
        .update(workflowRuns)
        .set({
          status: 'failed',
          errorCode: 'INTERNAL',
          errorStage: 'callback',
          errorMessage: message,
          retryable: false,
          finishedAt: now
        })
        .where(eq(workflowRuns.id, runId));
      return { type: 'invalid', runId, contract: run.contract };
    }

    const callback = parsed.data;
    const executionRef = callback.execution_ref ?? run.n8nExecutionRef;
    if (callback.status === 'succeeded') {
      await tx
        .update(workflowRuns)
        .set({
          status: 'succeeded',
          // Transitional storage until domain tables exist (see docs/persistence.md).
          result: {
            completed_at: callback.completed_at,
            versions: callback.versions,
            models: callback.models,
            result: callback.result
          },
          n8nExecutionRef: executionRef,
          finishedAt: now
        })
        .where(eq(workflowRuns.id, runId));
    } else {
      await tx
        .update(workflowRuns)
        .set({
          status: 'failed',
          errorCode: callback.error.code,
          errorStage: callback.error.stage,
          errorMessage: callback.error.message,
          retryable: callback.error.retryable,
          n8nExecutionRef: executionRef,
          finishedAt: now
        })
        .where(eq(workflowRuns.id, runId));
    }

    if (materialize) await materialize(tx, run, callback);
    return { type: 'processed', runId, contract: run.contract, status: callback.status };
  });
}

const MAX_REPORTED_PATHS = 10;

/** Issue locations only: never echoes payload values into the database. */
function describeIssues(error: z.ZodError | undefined): string {
  const paths = [
    ...new Set(
      (error?.issues ?? []).map((issue) =>
        issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'
      )
    )
  ];
  const shown = paths.slice(0, MAX_REPORTED_PATHS).map((path) => path.slice(0, 80));
  const more = paths.length > shown.length ? ` (+${paths.length - shown.length} more)` : '';
  return `Callback payload failed contract validation at: ${shown.join(', ')}${more}`;
}
