import { expect, test } from '@playwright/test';
import { signInAsTestUser } from './support/clerk-auth';

// Owner flow against the fake n8n transport: create, paste, analyze, see the result,
// reload, and see it again from PostgreSQL. The server must run with N8N_MODE=fake and a
// migrated DATABASE_URL (see playwright.config.ts).

const testUserId = process.env.E2E_CLERK_USER_ID;

const LISTING = [
  'We need a senior Next.js developer to build an internal dashboard.',
  'Stack: Next.js, TypeScript, PostgreSQL. Budget: $3,000 fixed.',
  'Payment verified. 12 hires, $40k spent. Less than 5 proposals.'
].join('\n');

test.describe('manual job analysis', () => {
  test.skip(!testUserId, 'Set E2E_CLERK_USER_ID to a dedicated Clerk test user to run.');

  test('the owner analyzes a pasted job end to end', async ({ page }) => {
    test.setTimeout(90_000);
    await signInAsTestUser(page, testUserId as string);

    await page.goto('/dashboard/jobs');
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
    await page.getByRole('link', { name: 'Analyze Job' }).first().click();

    await expect(page).toHaveURL(/\/dashboard\/jobs\/new$/);
    const title = `E2E fake analyze ${Date.now()}`;
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Full listing').fill(LISTING);
    await page.getByRole('button', { name: 'Analyze Job' }).click();

    await expect(page).toHaveURL(/\/dashboard\/jobs\/[0-9a-f-]{36}\?tab=analysis$/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('Analyzing job...')).toBeVisible();

    await expect(page.getByText('System score')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Analyzing job...')).toBeHidden();
    await expect(page.getByText('Dimensions')).toBeVisible();

    await page.reload();
    await expect(page.getByText('System score')).toBeVisible();
    await page.getByRole('tab', { name: 'Listing' }).click();
    await expect(page.getByText('Budget: $3,000 fixed.')).toBeVisible();
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByText('Analysis completed')).toBeVisible();
  });
});
