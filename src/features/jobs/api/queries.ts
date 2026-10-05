import { queryOptions } from '@tanstack/react-query';
import { getJob, getJobs, getWorkflowRun } from './service';
import type { EffectiveRunStatus, JobFilters, WorkflowRunView } from './types';

export const jobKeys = {
  all: ['jobs'] as const,
  lists: () => [...jobKeys.all, 'list'] as const,
  list: (filters: JobFilters) => [...jobKeys.lists(), filters] as const,
  detail: (id: string) => [...jobKeys.all, 'detail', id] as const,
  run: (id: string) => ['workflow-runs', id] as const
};

export const ACTIVE_RUN_POLL_MS = 2000;
export const TIMED_OUT_RUN_POLL_MS = 15000;

export function isRunActive(status: EffectiveRunStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running';
}

export function runPollInterval(run: WorkflowRunView | undefined): number | false {
  if (!run) return false;
  if (isRunActive(run.effective_status)) return ACTIVE_RUN_POLL_MS;
  // A timed-out run can still be failed by the server; check occasionally, not aggressively.
  if (run.effective_status === 'timed_out' && run.stored_status !== 'failed') {
    return TIMED_OUT_RUN_POLL_MS;
  }
  return false;
}

export const jobsQueryOptions = (filters: JobFilters) =>
  queryOptions({
    queryKey: jobKeys.list(filters),
    queryFn: () => getJobs(filters)
  });

export const jobByIdOptions = (id: string) =>
  queryOptions({
    queryKey: jobKeys.detail(id),
    queryFn: () => getJob(id)
  });

export const workflowRunOptions = (run: WorkflowRunView) =>
  queryOptions({
    queryKey: jobKeys.run(run.id),
    queryFn: () => getWorkflowRun(run.id),
    initialData: run,
    initialDataUpdatedAt: 0,
    refetchInterval: (query) => runPollInterval(query.state.data),
    refetchIntervalInBackground: false
  });
