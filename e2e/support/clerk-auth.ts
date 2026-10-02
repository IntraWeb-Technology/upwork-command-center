import { createClerkClient } from '@clerk/nextjs/server';
import type { Page } from '@playwright/test';

// Signs a dedicated Clerk test user in without a password, using Clerk's supported
// testing mechanisms from the installed SDK:
// - a testing token (appended to Frontend API requests) bypasses bot protection
// - a short-lived sign-in token is redeemed in the browser with the `ticket` strategy
// Requires CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and E2E_CLERK_USER_ID.

interface ClerkBrowserApi {
  loaded: boolean;
  client: {
    signIn: {
      create(params: { strategy: 'ticket'; ticket: string }): Promise<{
        status: string | null;
        createdSessionId: string | null;
      }>;
    };
  };
  setActive(params: { session: string | null }): Promise<void>;
}

function frontendApiHost(publishableKey: string): string {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, '');
  return Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for authenticated E2E tests.`);
  return value;
}

export async function signInAsTestUser(page: Page, userId: string): Promise<void> {
  const clerk = createClerkClient({ secretKey: requireEnv('CLERK_SECRET_KEY') });
  const [testingToken, signInToken] = await Promise.all([
    clerk.testingTokens.createTestingToken(),
    clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 300 })
  ]);

  const host = frontendApiHost(requireEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'));
  await page.route(`https://${host}/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('__clerk_testing_token', testingToken.token);
    await route.continue({ url: url.toString() });
  });

  await page.goto('/auth/sign-in');
  await page.waitForFunction(
    () => (window as unknown as { Clerk?: ClerkBrowserApi }).Clerk?.loaded === true
  );

  await page.evaluate(async (ticket) => {
    const clerkJs = (window as unknown as { Clerk: ClerkBrowserApi }).Clerk;
    const attempt = await clerkJs.client.signIn.create({ strategy: 'ticket', ticket });
    if (attempt.status !== 'complete') throw new Error(`Sign-in status: ${attempt.status}`);
    await clerkJs.setActive({ session: attempt.createdSessionId });
  }, signInToken.token);
}
