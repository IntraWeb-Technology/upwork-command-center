import { describe, expect, it } from 'vitest';

import { safeEqual } from '@/server/security/safe-equal';

import { callbackTokenMatches, generateCallbackToken, hashCallbackToken } from './callback-token';
import { getEffectiveStatus } from './effective-status';
import { isUuid, uuidv7 } from './ids';

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 UUIDs that embed the timestamp', () => {
    const now = new Date('2026-10-01T12:34:56.789Z');
    const id = uuidv7(now);

    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now.getTime());
  });

  it('sorts by creation time and does not repeat', () => {
    const earlier = uuidv7(new Date('2026-01-01T00:00:00.000Z'));
    const later = uuidv7(new Date('2026-01-01T00:00:00.001Z'));
    expect(earlier < later).toBe(true);

    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});

describe('callback tokens', () => {
  it('generates high-entropy, unique, URL-safe tokens accepted by the contract', () => {
    const token = generateCallbackToken();
    expect(token).toMatch(/^rt_[A-Za-z0-9_-]{43}$/);
    expect(generateCallbackToken()).not.toBe(token);
  });

  it('stores a SHA-256 digest that differs from the token', () => {
    const token = generateCallbackToken();
    const hash = hashCallbackToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('matches only the correct token, whatever the length of a wrong one', () => {
    const token = generateCallbackToken();
    const hash = hashCallbackToken(token);
    const sameLength = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    expect(callbackTokenMatches(token, hash)).toBe(true);
    expect(callbackTokenMatches(sameLength, hash)).toBe(false);
    expect(callbackTokenMatches(`${token}x`, hash)).toBe(false);
    expect(callbackTokenMatches('', hash)).toBe(false);
    expect(callbackTokenMatches(token, 'not-a-digest')).toBe(false);
  });

  it('compares shared tokens of different lengths without throwing', () => {
    expect(safeEqual('secret-value', 'secret-value')).toBe(true);
    expect(safeEqual('secret-value', 'secret-valuf')).toBe(false);
    expect(() => safeEqual('short', 'a much longer secret value')).not.toThrow();
    expect(safeEqual('short', 'a much longer secret value')).toBe(false);
  });
});

describe('getEffectiveStatus', () => {
  const deadlineAt = new Date('2026-01-01T00:05:00.000Z');
  const justBefore = new Date(deadlineAt.getTime() - 1);
  const justAfter = new Date(deadlineAt.getTime() + 1);

  it.each(['queued', 'running'] as const)('keeps %s up to and including the deadline', (status) => {
    expect(getEffectiveStatus({ status, deadlineAt }, justBefore)).toBe(status);
    expect(getEffectiveStatus({ status, deadlineAt }, deadlineAt)).toBe(status);
    expect(getEffectiveStatus({ status, deadlineAt }, justAfter)).toBe('timed_out');
  });

  it.each(['succeeded', 'failed'] as const)('never times out a %s run', (status) => {
    expect(getEffectiveStatus({ status, deadlineAt }, justAfter)).toBe(status);
    expect(getEffectiveStatus({ status, deadlineAt }, new Date('2030-01-01'))).toBe(status);
  });
});
