import { withOwner } from '@/server/auth/require-owner';
import { handleCreateJob, handleListJobs } from '@/server/jobs/http';
import { jobsHttpDeps } from '@/server/jobs/http-deps';

export const runtime = 'nodejs';

export const GET = withOwner((request: Request) => handleListJobs(request, jobsHttpDeps));
export const POST = withOwner((request: Request) => handleCreateJob(request, jobsHttpDeps));
