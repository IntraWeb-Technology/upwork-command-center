'use client';

import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isRunActive, jobKeys, workflowRunOptions } from '../api/queries';
import type { JobDetail, WorkflowRunView } from '../api/types';

/**
 * Polls the job's latest analyze run while it is active and refreshes the job once the
 * run settles, so the persisted analysis (or failure) replaces the running state.
 */
export function useLatestRun(job: JobDetail): WorkflowRunView | null {
  const queryClient = useQueryClient();
  const run = job.latest_run;

  const { data } = useQuery(
    run ? workflowRunOptions(run) : { queryKey: jobKeys.run('none'), queryFn: skipToken }
  );

  const current = run ? (data ?? run) : null;
  const settled =
    run !== null &&
    current !== null &&
    isRunActive(run.effective_status) &&
    !isRunActive(current.effective_status);

  useEffect(() => {
    if (settled) void queryClient.invalidateQueries({ queryKey: jobKeys.all });
  }, [settled, queryClient]);

  // Until the refreshed job arrives, its analysis and actions still describe the active run.
  return settled ? run : current;
}
