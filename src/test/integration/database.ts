import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

import { createDatabase, createPool, type Database } from '@/server/db/client';

export interface TestDatabase {
  readonly db: Database;
  readonly pool: Pool;
}

/**
 * Connects to this run's private database (created by global-setup.ts) and truncates
 * every application table before each test. Other runs use other databases.
 */
export function setupTestDatabase(): TestDatabase {
  let pool: Pool | undefined;
  let db: Database | undefined;

  beforeAll(() => {
    pool = createPool(inject('testDatabaseUrl'));
    db = createDatabase(pool);
  });

  beforeEach(async () => {
    const tables = await pool!.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'"
    );
    if (tables.rows.length === 0) return;
    const list = tables.rows.map(({ tablename }) => `"${tablename}"`).join(', ');
    await pool!.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
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
