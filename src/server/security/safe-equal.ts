import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison. Both values are hashed first so the
 * comparison runs on equal-length buffers and does not leak length.
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}
