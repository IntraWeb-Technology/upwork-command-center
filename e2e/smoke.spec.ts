import { expect, test } from '@playwright/test';

// Foundation smoke tests: no credentials, no signed-in user.

test('sign-in page is served', async ({ page }) => {
  const response = await page.goto('/auth/sign-in');

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Sign In/);
});

test('signed-out visitors are sent from the dashboard to sign-in', async ({ page }) => {
  await page.goto('/dashboard/overview');

  await expect(page).toHaveURL(/\/auth\/sign-in/);
});

test('reference API routes reject signed-out requests', async ({ request }) => {
  for (const path of ['/api/products', '/api/users']) {
    const response = await request.get(path);

    expect(response.status(), path).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  }
});

test('the n8n callback route is machine-authenticated, not redirected to Clerk', async ({
  request
}) => {
  const response = await request.post('/api/integrations/n8n/callback', {
    data: { run_id: 'unknown', callback_token: 'x', contract: 'ujh.analyze.v1' },
    maxRedirects: 0
  });

  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: 'unauthorized' });
});
