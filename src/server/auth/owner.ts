import { safeEqual } from '@/server/security/safe-equal';

export type OwnerAuthorization =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; code: 'UNAUTHENTICATED' | 'FORBIDDEN' };

/**
 * Single-owner policy: Clerk authenticates, and only the configured owner is
 * authorized. Signed out is 401; signed in as anyone else is 403.
 */
export function authorizeOwner(
  userId: string | null | undefined,
  ownerUserId: string
): OwnerAuthorization {
  if (!userId) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
  if (!safeEqual(userId, ownerUserId)) return { ok: false, status: 403, code: 'FORBIDDEN' };
  return { ok: true, userId };
}
