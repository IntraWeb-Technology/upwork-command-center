import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import type { TestProject } from 'vitest/node';

import {
  createRunDatabaseName,
  isStaleRunDatabase,
  resolveAdminDatabaseUrl,
  withDatabase
} from './test-database-url';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

async function adminQuery(adminUrl: string, run: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Each integration run gets its own database, so concurrent runs (terminal, IDE, CI) can
 * never truncate or drop each other's data. Migrations are applied inside it, which also
 * proves they apply to an empty database. The teardown drops only this run's database.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const adminUrl = resolveAdminDatabaseUrl();
  const runDatabase = createRunDatabaseName(adminUrl);
  const runUrl = withDatabase(adminUrl, runDatabase);

  try {
    await adminQuery(adminUrl, async (client) => {
      const existing = await client.query<{ datname: string }>(
        'select datname from pg_database where datistemplate = false'
      );
      for (const { datname } of existing.rows) {
        if (isStaleRunDatabase(adminUrl, datname)) {
          await client.query(`DROP DATABASE IF EXISTS ${quote(datname)} WITH (FORCE)`);
        }
      }
      await client.query(`CREATE DATABASE ${quote(runDatabase)}`);
    });

    const pool = new Pool({ connectionString: runUrl, max: 1 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    } finally {
      await pool.end();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Integration database setup failed (${reason}). Start it with: docker compose up -d --wait`,
      { cause: error }
    );
  }

  project.provide('testDatabaseUrl', runUrl);

  return async () => {
    await adminQuery(adminUrl, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${quote(runDatabase)} WITH (FORCE)`);
    });
  };
}
