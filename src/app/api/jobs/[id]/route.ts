import { withOwner } from '@/server/auth/require-owner';
import { handleGetJob, type IdRouteContext } from '@/server/jobs/http';
import { jobsHttpDeps } from '@/server/jobs/http-deps';

export const runtime = 'nodejs';

export const GET = withOwner((request: Request, context: IdRouteContext) =>
  handleGetJob(request, context, jobsHttpDeps)
);
