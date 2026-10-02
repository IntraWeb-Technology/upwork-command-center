import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;
// Optional dedicated Clerk test user. When set, the test server treats it as the owner.
const e2eUserId = process.env.E2E_CLERK_USER_ID;

// Runs against the production build: run `bun run build` first.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bun run start --port ${PORT}`,
    url: `${baseURL}/auth/sign-in`,
    // The test server never calls n8n: analyses go through the in-process fake transport.
    env: {
      N8N_MODE: 'fake',
      N8N_ALLOW_FAKE_IN_PRODUCTION: 'true',
      N8N_FAKE_DELAY_MS: process.env.N8N_FAKE_DELAY_MS ?? '3000',
      ...(e2eUserId ? { OWNER_CLERK_USER_ID: e2eUserId } : {})
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
