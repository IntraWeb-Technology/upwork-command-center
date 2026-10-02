import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import type { DbExecutor } from '@/server/db/client';
import { workflowRuns, type WorkflowRunRow } from '@/server/db/schema';

import { generateCallbackToken, hashCallbackToken } from './callback-token';
import { getEffectiveStatus } from './effective-status';
import { uuidv7 } from './ids';
import type { RequestSummary } from './request-summary';
import {
  DEFAULT_RUN_DEADLINE_MS,
  type EffectiveWorkflowRun,
  type RunFailure,
  type WorkflowContract,
  type WorkflowRun
} from './types';

export class RunStateError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'RunStateError';
  }
}

export function toWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  const { callbackTokenHash: _hash, ...run } = row;
  return { ...run, contract: run.contract as WorkflowContract };
}

export interface CreateWorkflowRunInput {
  contract: WorkflowContract;
  request: RequestSummary;
  /** Pre-generated UUIDv7, so the dispatch request can be built and validated first. */
  id?: string;
  /** Pre-generated token for the same reason; only its digest is stored. */
  callbackToken?: string;
  now?: Date;
  deadlineMs?: number;
  /** The failed run this one retries; the new run gets attempt = previous + 1. */
  retryOfRunId?: string;
  /** Owning job. At most one queued or running run per job and contract. */
  jobId?: string;
}

const ACTIVE_RUN_INDEX = 'workflow_runs_active_job_contract_unique';

export interface CreatedWorkflowRun {
  run: WorkflowRun;
  /** Plaintext, returned once for the dispatch request. Never persist or log it. */
  callbackToken: string;
}

/** Inserts a queued run. The caller must let this commit before dispatching to n8n. */
export async function createWorkflowRun(
  db: DbExecutor,
  input: CreateWorkflowRunInput
): Promise<CreatedWorkflowRun> {
  const now = input.now ?? new Date();
  const deadlineMs = input.deadlineMs ?? DEFAULT_RUN_DEADLINE_MS[input.contract];
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new RangeError('deadlineMs must be a positive number');
  }

  let attempt = 1;
  if (input.retryOfRunId) {
    const [previous] = await db
      .select({
        contract: workflowRuns.contract,
        status: workflowRuns.status,
        attempt: workflowRuns.attempt
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, input.retryOfRunId));
    if (!previous) throw new RunStateError('NOT_FOUND', 'retried run does not exist');
    if (previous.contract !== input.contract) {
      throw new RunStateError('CONFLICT', 'a retry must use the same contract');
    }
    if (previous.status !== 'failed') {
      throw new RunStateError('CONFLICT', 'only a failed run can be retried');
    }
    attempt = previous.attempt + 1;
  }

  const callbackToken = input.callbackToken ?? generateCallbackToken();
  try {
    const [row] = await db
      .insert(workflowRuns)
      .values({
        id: input.id ?? uuidv7(now),
        contract: input.contract,
        jobId: input.jobId ?? null,
        status: 'queued',
        request: input.request,
        callbackTokenHash: hashCallbackToken(callbackToken),
        attempt,
        retryOfRunId: input.retryOfRunId ?? null,
        requestedAt: now,
        deadlineAt: new Date(now.getTime() + deadlineMs)
      })
      .returning();
    return { run: toWorkflowRun(row), callbackToken };
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      if (pgConstraint(error) === ACTIVE_RUN_INDEX) {
        throw new RunStateError('CONFLICT', 'an active run already exists for this job');
      }
      if (input.retryOfRunId) {
        throw new RunStateError('CONFLICT', 'this run has already been retried');
      }
    }
    throw error;
  }
}

/** Active (queued or running) run of a job for a contract, if any. */
export async function getActiveJobRun(
  db: DbExecutor,
  jobId: string,
  contract: WorkflowContract
): Promise<WorkflowRun | null> {
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.jobId, jobId),
        eq(workflowRuns.contract, contract),
        inArray(workflowRuns.status, ['queued', 'running'])
      )
    );
  return row ? toWorkflowRun(row) : null;
}

function pgConstraint(error: unknown): string | null {
  for (let current = error; current instanceof Error; current = current.cause) {
    const constraint = (current as Error & { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') return constraint;
  }
  return null;
}

/** Postgres SQLSTATE from a pg error, including when Drizzle wraps it as the cause. */
export function pgErrorCode(error: unknown): string | null {
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}

export async function getWorkflowRun(db: DbExecutor, runId: string): Promise<WorkflowRun | null> {
  const [row] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  return row ? toWorkflowRun(row) : null;
}

/** Read model with the derived timeout. Performs no writes. */
export async function getEffectiveWorkflowRun(
  db: DbExecutor,
  runId: string,
  now: Date = new Date()
): Promise<EffectiveWorkflowRun | null> {
  const run = await getWorkflowRun(db, runId);
  return run ? { ...run, effectiveStatus: getEffectiveStatus(run, now) } : null;
}

/**
 * n8n acknowledged the run: queued to running only. Returns false when a callback already
 * moved the run to a terminal status, which is left untouched.
 */
export async function markDispatchAccepted(
  db: DbExecutor,
  runId: string,
  { executionRef, now = new Date() }: { executionRef: string | null; now?: Date }
): Promise<boolean> {
  const updated = await db
    .update(workflowRuns)
    .set({ status: 'running', dispatchedAt: now, n8nExecutionRef: executionRef })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, 'queued')))
    .returning({ id: workflowRuns.id });
  return updated.length > 0;
}

/** n8n definitively did not accept the run: queued to failed only. */
export async function markDispatchRejected(
  db: DbExecutor,
  runId: string,
  failure: RunFailure,
  now: Date = new Date()
): Promise<boolean> {
  return setFailed(db, runId, failure, now, ['queued']);
}

/**
 * Fails an active run (queued or running), for example a TIMEOUT before a retry.
 * A terminal run is never changed, so a failed run cannot be resurrected or overwritten.
 */
export async function failWorkflowRun(
  db: DbExecutor,
  runId: string,
  failure: RunFailure,
  now: Date = new Date()
): Promise<boolean> {
  return setFailed(db, runId, failure, now, ['queued', 'running']);
}

async function setFailed(
  db: DbExecutor,
  runId: string,
  failure: RunFailure,
  now: Date,
  from: Array<'queued' | 'running'>
): Promise<boolean> {
  const updated = await db
    .update(workflowRuns)
    .set({
      status: 'failed',
      errorCode: failure.code,
      errorStage: failure.stage,
      errorMessage: failure.message,
      retryable: failure.retryable,
      finishedAt: now
    })
    .where(and(eq(workflowRuns.id, runId), inArray(workflowRuns.status, from)))
    .returning({ id: workflowRuns.id });
  return updated.length > 0;
}
