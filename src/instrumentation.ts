import * as Sentry from '@sentry/nextjs';
import { isSentryEnabled, scrubSentryEvent } from '@/lib/sentry';

const sentryOptions: Sentry.NodeOptions | Sentry.EdgeOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Enable Spotlight in development
  spotlight: process.env.NODE_ENV === 'development',

  // Never attach cookies, IP addresses, or request bodies by default.
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1,

  debug: false
};

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getServerEnv } = await import('@/server/env');
    // Fail fast with a readable list of missing or invalid server variables.
    getServerEnv();
  }

  if (!isSentryEnabled()) return;

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(sentryOptions);
  }
}

export const onRequestError = Sentry.captureRequestError;
