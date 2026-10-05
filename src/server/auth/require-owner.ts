import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getServerEnv } from '@/server/env';
import { authorizeOwner, type OwnerAuthorization } from './owner';

const errorMessages = {
  UNAUTHENTICATED: 'Sign in required.',
  FORBIDDEN: 'This account is not authorized to use this application.'
} as const;

export async function getOwnerAuthorization(): Promise<OwnerAuthorization> {
  const { userId } = await auth();
  return authorizeOwner(userId, getServerEnv().OWNER_CLERK_USER_ID);
}

export type RequireOwnerResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/** Route boundary check. Returns a ready 401/403 JSON response when denied. */
export async function requireOwner(): Promise<RequireOwnerResult> {
  const authorization = await getOwnerAuthorization();
  if (authorization.ok) return authorization;

  return {
    ok: false,
    response: NextResponse.json(
      { error: { code: authorization.code, message: errorMessages[authorization.code] } },
      { status: authorization.status }
    )
  };
}

/** Wraps a route handler so it only runs for the authenticated owner. */
export function withOwner<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    const owner = await requireOwner();
    if (!owner.ok) return owner.response;
    return handler(...args);
  };
}
