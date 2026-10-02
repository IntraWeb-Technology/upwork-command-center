import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Runs against a real PostgreSQL database (see docs/persistence.md). The global setup
// recreates the schema from the committed migrations, and tests truncate between cases.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./src/test/integration/global-setup.ts'],
    // One shared database: files run sequentially so truncation never races.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    restoreMocks: true,
    unstubEnvs: true
  }
});
