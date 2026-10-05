import { withOwner } from '@/server/auth/require-owner';
import { handleOverride, type IdRouteContext } from '@/server/jobs/http';
import { jobsHttpDeps } from '@/server/jobs/http-deps';

export const runtime = 'nodejs';

export const PUT = withOwner((request: Request, context: IdRouteContext) =>
  handleOverride(request, context, jobsHttpDeps)
);
