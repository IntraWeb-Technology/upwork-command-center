import { withOwner } from '@/server/auth/require-owner';
import { handleStartAnalysis, type IdRouteContext } from '@/server/jobs/http';
import { jobsHttpDeps } from '@/server/jobs/http-deps';

export const runtime = 'nodejs';

export const POST = withOwner((request: Request, context: IdRouteContext) =>
  handleStartAnalysis(request, context, jobsHttpDeps)
);
