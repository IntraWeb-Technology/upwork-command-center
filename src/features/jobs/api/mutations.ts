import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { createJob, declineJob, overrideAnalysis, startAnalysis } from './service';
import { jobKeys } from './queries';
import type { CreateJobPayload, JobDetail, OverridePayload } from './types';

// Cache updates live in onSettled so components can supply their own onSuccess/onError.

function storeDetail(detail: JobDetail | undefined): Promise<void> {
  const queryClient = getQueryClient();
  if (detail) queryClient.setQueryData(jobKeys.detail(detail.id), detail);
  return queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
}

export const createJobMutation = mutationOptions({
  mutationFn: (payload: CreateJobPayload) => createJob(payload),
  onSettled: (data) => storeDetail(data?.job)
});

export const startAnalysisMutation = mutationOptions({
  mutationFn: (jobId: string) => startAnalysis(jobId),
  onSettled: () => getQueryClient().invalidateQueries({ queryKey: jobKeys.all })
});

export const declineJobMutation = mutationOptions({
  mutationFn: ({ jobId, reason }: { jobId: string; reason: string }) => declineJob(jobId, reason),
  onSettled: (data) => storeDetail(data)
});

export const overrideAnalysisMutation = mutationOptions({
  mutationFn: ({ jobId, payload }: { jobId: string; payload: OverridePayload }) =>
    overrideAnalysis(jobId, payload),
  onSettled: (data) => storeDetail(data)
});
