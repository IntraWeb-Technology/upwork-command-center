import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Runs against a real PostgreSQL database (see docs/persistence.md). The global setup creates
// a private database for this run and migrates it; tests truncate it between cases.
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
    // Files share this run's database, so they run sequentially and truncation never races.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    restoreMocks: true,
    unstubEnvs: true
  }
});
