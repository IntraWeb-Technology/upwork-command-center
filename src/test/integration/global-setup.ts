import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { resolveTestDatabaseUrl } from './test-database-url';

// Starts every run from an empty database and applies the committed migrations, which is
// also the "migrations apply to an empty database" check.
export default async function setup(): Promise<void> {
  const pool = new Pool({ connectionString: resolveTestDatabaseUrl(), max: 1 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Integration database setup failed (${reason}). Start it with: docker compose up -d --wait`,
      { cause: error }
    );
  } finally {
    await pool.end();
  }
}
