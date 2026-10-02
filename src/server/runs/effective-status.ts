import { isTerminal, type EffectiveRunStatus, type PersistedRunStatus } from './types';

interface StatusInput {
  status: PersistedRunStatus;
  deadlineAt: Date;
}

/**
 * Derived, read-only timeout. A non-terminal run is timed out only once the deadline has
 * strictly passed (`deadline_at < now`); at the exact deadline instant it is still active.
 */
export function getEffectiveStatus(run: StatusInput, now: Date = new Date()): EffectiveRunStatus {
  if (isTerminal(run.status)) return run.status;
  return run.deadlineAt.getTime() < now.getTime() ? 'timed_out' : run.status;
}
