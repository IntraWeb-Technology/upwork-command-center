import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseServerEnv } from '@/server/env';
import { JobDomainError } from '@/server/jobs/errors';

import { getAnalysisRuntime, resolveN8nMode } from './runtime';

const BASE_ENV = {
  CLERK_SECRET_KEY: 'sk_test_synthetic',
  OWNER_CLERK_USER_ID: 'user_test_owner'
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('n8n transport selection', () => {
  it('defaults to remote, so the fake transport is never selected implicitly', () => {
    expect(resolveN8nMode(parseServerEnv(BASE_ENV), 'development')).toBe('remote');
    expect(resolveN8nMode(parseServerEnv(BASE_ENV), 'production')).toBe('remote');
  });

  it('refuses fake mode in a production build unless explicitly allowed', () => {
    const fake = parseServerEnv({ ...BASE_ENV, N8N_MODE: 'fake' });
    expect(resolveN8nMode(fake, 'development')).toBe('fake');
    expect(resolveN8nMode(fake, 'test')).toBe('fake');
    expect(() => resolveN8nMode(fake, 'production')).toThrow(JobDomainError);
    const allowed = parseServerEnv({
      ...BASE_ENV,
      N8N_MODE: 'fake',
      N8N_ALLOW_FAKE_IN_PRODUCTION: 'true'
    });
    expect(resolveN8nMode(allowed, 'production')).toBe('fake');
  });

  it('rejects unknown modes and scenarios at env validation', () => {
    expect(() => parseServerEnv({ ...BASE_ENV, N8N_MODE: 'mock' })).toThrow('N8N_MODE');
    expect(() => parseServerEnv({ ...BASE_ENV, N8N_FAKE_SCENARIO: 'random' })).toThrow(
      'N8N_FAKE_SCENARIO'
    );
  });

  it('requires n8n configuration only when a remote run is started', () => {
    for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
    vi.stubEnv('N8N_MODE', 'remote');
    expect(() => getAnalysisRuntime('http://localhost:3000')).toThrow(JobDomainError);

    vi.stubEnv('N8N_BASE_URL', 'https://n8n.example.com');
    vi.stubEnv('N8N_WEBHOOK_TOKEN', 'w'.repeat(40));
    vi.stubEnv('APP_BASE_URL', 'https://command.example.com');
    const runtime = getAnalysisRuntime('http://localhost:3000');
    expect(runtime.mode).toBe('remote');
    expect(runtime.callbackUrl).toBe('https://command.example.com/api/integrations/n8n/callback');
  });

  it('derives the fake callback URL from the request origin without n8n configuration', () => {
    for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
    vi.stubEnv('N8N_MODE', 'fake');
    const runtime = getAnalysisRuntime('http://localhost:3000');
    expect(runtime).toMatchObject({
      mode: 'fake',
      callbackUrl: 'http://localhost:3000/api/integrations/n8n/callback'
    });
  });
});
