import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it, vi } from 'vitest';
import { isSentryEnabled, scrubSentryEvent } from './sentry';

describe('isSentryEnabled', () => {
  it('is inactive without a DSN', () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    expect(isSentryEnabled()).toBe(false);
  });

  it('is active with a DSN unless explicitly disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DISABLED', 'false');
    expect(isSentryEnabled()).toBe(true);

    vi.stubEnv('NEXT_PUBLIC_SENTRY_DISABLED', 'true');
    expect(isSentryEnabled()).toBe(false);
  });
});

describe('scrubSentryEvent', () => {
  it('removes credentials from request data', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: 'https://example.com/api/products',
        cookies: { __session: 'session-secret' },
        data: '{"listing":"private"}',
        headers: {
          Authorization: 'Bearer secret',
          cookie: '__session=session-secret',
          'x-ujh-token': 'webhook-secret',
          'user-agent': 'test'
        },
        query_string: 'page=1&token=abc123'
      }
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.headers).toEqual({ 'user-agent': 'test' });
    expect(scrubbed.request?.query_string).toBe('page=1&token=%5BFiltered%5D');
    expect(JSON.stringify(scrubbed)).not.toContain('secret');
    expect(JSON.stringify(scrubbed)).not.toContain('abc123');
  });
});
