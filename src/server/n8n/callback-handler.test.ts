import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/server/db/client';

import { handleN8nCallback, MAX_CALLBACK_BYTES } from './callback-handler';

// Paths that must be decided before any database access. getDb throws to prove it.
const TOKEN = 'unit-shared-callback-token-0123456789abcdef';
const getDb = vi.fn((): Database => {
  throw new Error('database must not be touched');
});
const deps = { getDb, callbackToken: TOKEN };

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/integrations/n8n/callback', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
    body
  });
}

describe('handleN8nCallback (before the database)', () => {
  it('returns 413 for a declared length above the limit', async () => {
    const response = await handleN8nCallback(
      post('{}', { 'content-length': String(MAX_CALLBACK_BYTES + 1) }),
      deps
    );
    expect(response.status).toBe(413);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed Content-Length', async () => {
    const response = await handleN8nCallback(post('{}', { 'content-length': '12abc' }), deps);
    expect(response.status).toBe(400);
  });

  it('returns 401 with a Bearer challenge and does not echo the presented token', async () => {
    const response = await handleN8nCallback(
      post('{}', { authorization: 'Bearer presented-wrong-token' }),
      deps
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.text()).not.toContain('presented-wrong-token');
  });

  it('rejects non-Bearer schemes', async () => {
    const response = await handleN8nCallback(post('{}', { authorization: TOKEN }), deps);
    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid UTF-8 or JSON', async () => {
    const invalidUtf8 = new Request('http://localhost/api/integrations/n8n/callback', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])
    });
    expect((await handleN8nCallback(invalidUtf8, deps)).status).toBe(400);
    expect((await handleN8nCallback(post('not json'), deps)).status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns a generic 500 when the database is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handleN8nCallback(
      post(JSON.stringify({ run_id: 'x', callback_token: 'y', contract: 'z' })),
      deps
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
  });

  it('marks every response as non-cacheable', async () => {
    const response = await handleN8nCallback(post('not json'), deps);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
