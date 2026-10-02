import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

// Migrations prefer a direct (non-pooled) connection when one is configured.
const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: false,
  ...(url ? { dbCredentials: { url } } : {})
});
