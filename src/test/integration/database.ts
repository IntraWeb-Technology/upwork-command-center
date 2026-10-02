import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { createDatabase, createPool, type Database } from '@/server/db/client';

import { resolveTestDatabaseUrl } from './test-database-url';

export interface TestDatabase {
  readonly db: Database;
  readonly pool: Pool;
}

/** Connects once per file and truncates every table before each test. */
export function setupTestDatabase(): TestDatabase {
  let pool: Pool | undefined;
  let db: Database | undefined;

  beforeAll(() => {
    pool = createPool(resolveTestDatabaseUrl());
    db = createDatabase(pool);
  });

  beforeEach(async () => {
    await pool?.query('TRUNCATE TABLE workflow_runs RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool?.end();
  });

  return {
    get db() {
      if (!db) throw new Error('test database is not connected');
      return db;
    },
    get pool() {
      if (!pool) throw new Error('test database is not connected');
      return pool;
    }
  };
}
