import 'server-only';
import { getOwnerAuthorization } from '@/server/auth/require-owner';
import { getDb } from '@/server/db/client';
import { getJobDetail, listJobs } from '@/server/jobs/read-models';
import { jobsQueryOptions } from '../api/queries';
import type { JobDetail, JobFilters, JobListResponse } from '../api/types';

// Server-side reads for the Jobs pages. They use the same query keys as the client
// options but read the database directly instead of fetching a relative /api URL.
// Pages render in parallel with the dashboard layout, which redirects or denies
// non-owners, so these reads check the owner themselves and return nothing for others.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function isOwnerRequest(): Promise<boolean> {
  return (await getOwnerAuthorization()).ok;
}

/** Only use after `isOwnerRequest()` returned true. */
export function serverJobsQueryOptions(filters: JobFilters) {
  return {
    ...jobsQueryOptions(filters),
    queryFn: (): Promise<JobListResponse> => listJobs(getDb(), filters)
  };
}

/** Returns null for malformed or unknown ids so the page can render notFound(). */
export async function readJobDetail(jobId: string): Promise<JobDetail | null> {
  if (!UUID_PATTERN.test(jobId)) return null;
  return getJobDetail(getDb(), jobId);
}
