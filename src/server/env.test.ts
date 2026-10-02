import { describe, expect, it } from 'vitest';
import { parseServerEnv, requireServerEnv, ServerEnvError } from './env';

const validEnv = {
  CLERK_SECRET_KEY: 'sk_test_placeholder_value',
  OWNER_CLERK_USER_ID: 'user_placeholderOwner'
};

function captureError(source: Record<string, string | undefined>): ServerEnvError {
  try {
    parseServerEnv(source);
  } catch (error) {
    if (error instanceof ServerEnvError) return error;
    throw error;
  }
  throw new Error('Expected parseServerEnv to throw');
}

describe('parseServerEnv', () => {
  it('parses the foundation variables without requiring future integrations', () => {
    const env = parseServerEnv(validEnv);

    expect(env.CLERK_SECRET_KEY).toBe(validEnv.CLERK_SECRET_KEY);
    expect(env.OWNER_CLERK_USER_ID).toBe(validEnv.OWNER_CLERK_USER_ID);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.N8N_BASE_URL).toBeUndefined();
  });

  it('reports every missing required variable by name', () => {
    const error = captureError({});

    expect(error.problems).toEqual([
      'CLERK_SECRET_KEY is required',
      'OWNER_CLERK_USER_ID is required'
    ]);
    expect(error.message).toContain('Invalid server environment');
  });

  it('treats empty strings as missing', () => {
    const error = captureError({ ...validEnv, OWNER_CLERK_USER_ID: '  ' });

    expect(error.problems).toEqual(['OWNER_CLERK_USER_ID is required']);
  });

  it('never echoes secret values in validation errors', () => {
    const leakedSecret = 'not-a-clerk-key-SUPERSECRET123';
    const leakedDbPassword = 'dbpassword-SUPERSECRET456';
    const leakedToken = 'short-SUPERSECRET789';

    const error = captureError({
      CLERK_SECRET_KEY: leakedSecret,
      OWNER_CLERK_USER_ID: 'owner-SUPERSECRET000',
      DATABASE_URL: `not a url ${leakedDbPassword}`,
      N8N_CALLBACK_TOKEN: leakedToken
    });

    expect(error.problems).toEqual([
      'CLERK_SECRET_KEY must be a Clerk secret key (sk_...)',
      'OWNER_CLERK_USER_ID must be a Clerk user ID (user_...)',
      'DATABASE_URL must be a postgres:// or postgresql:// URL',
      'N8N_CALLBACK_TOKEN must be at least 32 characters'
    ]);
    expect(error.message).not.toContain('SUPERSECRET');
    expect(JSON.stringify(error.problems)).not.toContain('SUPERSECRET');
  });

  it('validates future integration variables only when they are present', () => {
    const env = parseServerEnv({
      ...validEnv,
      N8N_BASE_URL: 'https://n8n.example.com',
      N8N_WEBHOOK_TOKEN: 'x'.repeat(32)
    });

    expect(env.N8N_BASE_URL).toBe('https://n8n.example.com');
  });

  it('accepts only postgres URLs for the database variables', () => {
    const env = parseServerEnv({
      ...validEnv,
      DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
      DATABASE_URL_DIRECT: 'postgresql://user:pass@localhost:5432/app'
    });
    expect(env.DATABASE_URL).toBe('postgres://user:pass@localhost:5432/app');

    const error = captureError({ ...validEnv, DATABASE_URL_DIRECT: 'mysql://localhost/app' });
    expect(error.problems).toEqual([
      'DATABASE_URL_DIRECT must be a postgres:// or postgresql:// URL'
    ]);
  });
});

describe('requireServerEnv', () => {
  it('returns a configured optional variable', () => {
    const env = parseServerEnv({ ...validEnv, DATABASE_URL: 'postgres://localhost/app' });
    expect(requireServerEnv('DATABASE_URL', env)).toBe('postgres://localhost/app');
  });

  it('names the missing variable without failing unrelated features at startup', () => {
    const env = parseServerEnv(validEnv);
    expect(() => requireServerEnv('DATABASE_URL', env)).toThrow(
      'DATABASE_URL is required for this feature'
    );
  });
});
