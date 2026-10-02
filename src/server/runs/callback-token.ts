import { createHash, randomBytes } from 'node:crypto';

import { safeEqual } from '@/server/security/safe-equal';

// The plaintext token exists only in memory during dispatch and in the n8n request.
// Only its SHA-256 digest is persisted; it must never be logged or sent to Sentry.

export function generateCallbackToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}

export function hashCallbackToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time check of a presented token against a stored digest (any lengths). */
export function callbackTokenMatches(presented: string, storedHash: string): boolean {
  return safeEqual(hashCallbackToken(presented), storedHash);
}
