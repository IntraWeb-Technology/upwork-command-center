import { describe, expect, it, vi } from 'vitest';

import {
  createRunDatabaseName,
  isStaleRunDatabase,
  resolveAdminDatabaseUrl,
  withDatabase
} from './test-database-url';

const ADMIN = 'postgres://u:p@127.0.0.1:5432/ucc_test';

describe('integration run databases', () => {
  it('creates unique, timestamped names that still end in _test', () => {
    const now = new Date('2026-10-02T07:15:30.000Z');
    const a = createRunDatabaseName(ADMIN, now);
    const b = createRunDatabaseName(ADMIN, now);

    expect(a).toMatch(/^ucc_r20261002071530[0-9a-f]{6}_test$/);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(63);
  });

  it('treats only old run databases of this prefix as stale', () => {
    const now = new Date('2026-10-02T12:00:00.000Z');
    const old = createRunDatabaseName(ADMIN, new Date('2026-10-02T09:00:00.000Z'));
    const fresh = createRunDatabaseName(ADMIN, new Date('2026-10-02T11:30:00.000Z'));

    expect(isStaleRunDatabase(ADMIN, old, now)).toBe(true);
    expect(isStaleRunDatabase(ADMIN, fresh, now)).toBe(false);
    expect(isStaleRunDatabase(ADMIN, 'ucc_test', now)).toBe(false);
    expect(isStaleRunDatabase(ADMIN, 'ucc_dev', now)).toBe(false);
    expect(isStaleRunDatabase(ADMIN, 'other_r20200101000000abcdef_test', now)).toBe(false);
  });

  it('refuses an admin database that does not end in _test', () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgres://u:p@localhost/ucc_dev');
    expect(() => resolveAdminDatabaseUrl()).toThrow('does not end in "_test"');
  });

  it('swaps only the database name in a URL', () => {
    expect(withDatabase(ADMIN, 'ucc_rX_test')).toBe('postgres://u:p@127.0.0.1:5432/ucc_rX_test');
  });
});
