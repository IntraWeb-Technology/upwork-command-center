import { withOwner } from '@/server/auth/require-owner';
import { handleAddListing, type IdRouteContext } from '@/server/jobs/http';
import { jobsHttpDeps } from '@/server/jobs/http-deps';

export const runtime = 'nodejs';

export const POST = withOwner((request: Request, context: IdRouteContext) =>
  handleAddListing(request, context, jobsHttpDeps)
);
