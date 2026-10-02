import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url))
    }
  },
  test: {
    // Server and domain tests run in Node. Component tests opt into jsdom with
    // a `// @vitest-environment jsdom` comment at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    unstubEnvs: true
  }
});
