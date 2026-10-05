import { withOwner } from '@/server/auth/require-owner';
import { handleGetWorkflowRun, type IdRouteContext } from '@/server/jobs/http';
import { jobsHttpDeps } from '@/server/jobs/http-deps';

export const runtime = 'nodejs';

export const GET = withOwner((request: Request, context: IdRouteContext) =>
  handleGetWorkflowRun(request, context, jobsHttpDeps)
);
