import 'server-only';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { requireServerEnv } from '@/server/env';

import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type DbExecutor = Database | Transaction;

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

interface DatabaseCache {
  pool: Pool;
  db: Database;
}

// Survives Next.js dev module reloads so each reload does not open a new pool.
const globalCache = globalThis as typeof globalThis & { uccDatabaseCache?: DatabaseCache };

/** Lazily connects on first use; throws if DATABASE_URL is not configured. */
export function getDb(): Database {
  if (!globalCache.uccDatabaseCache) {
    const pool = createPool(requireServerEnv('DATABASE_URL'));
    pool.on('error', (error) => {
      // Messages can name the database host, so only the code is logged.
      const code = (error as Error & { code?: unknown }).code;
      console.error('[db] idle client error', { code: typeof code === 'string' ? code : null });
    });
    globalCache.uccDatabaseCache = { pool, db: createDatabase(pool) };
  }
  return globalCache.uccDatabaseCache.db;
}
