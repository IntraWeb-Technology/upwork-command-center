import type { ErrorCode } from '@/contracts';
import type { WorkflowRunRow } from '@/server/db/schema';

export const WORKFLOW_CONTRACTS = ['ujh.analyze.v1', 'ujh.generate_proposal.v1'] as const;
export type WorkflowContract = (typeof WORKFLOW_CONTRACTS)[number];

export function isWorkflowContract(value: unknown): value is WorkflowContract {
  return typeof value === 'string' && (WORKFLOW_CONTRACTS as readonly string[]).includes(value);
}

export type PersistedRunStatus = WorkflowRunRow['status'];
export type EffectiveRunStatus = PersistedRunStatus | 'timed_out';

export const TERMINAL_STATUSES: readonly PersistedRunStatus[] = ['succeeded', 'failed'];

export function isTerminal(status: PersistedRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** A run as exposed outside the persistence layer: never includes the token digest. */
export type WorkflowRun = Omit<WorkflowRunRow, 'callbackTokenHash' | 'contract'> & {
  contract: WorkflowContract;
};

export interface EffectiveWorkflowRun extends WorkflowRun {
  effectiveStatus: EffectiveRunStatus;
}

export interface RunFailure {
  code: ErrorCode;
  stage: string | null;
  message: string;
  retryable: boolean;
}

/** Initial per-contract deadlines (architecture Section 8); tune after measuring real runs. */
export const DEFAULT_RUN_DEADLINE_MS: Record<WorkflowContract, number> = {
  'ujh.analyze.v1': 5 * 60_000,
  'ujh.generate_proposal.v1': 5 * 60_000
};
