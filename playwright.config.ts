import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
