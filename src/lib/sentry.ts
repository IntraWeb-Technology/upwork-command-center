import type { ErrorEvent } from '@sentry/nextjs';

/** Sentry runs only with a DSN and when not explicitly disabled. */
export function isSentryEnabled(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) &&
    process.env.NEXT_PUBLIC_SENTRY_DISABLED !== 'true'
  );
}

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-ujh-token|x-api-key)$/i;
const SENSITIVE_QUERY_PARAM = /(token|secret|key|password|signature)/i;

/** Removes credentials from request data before an event leaves the process. */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (!request) return event;

  delete request.cookies;
  delete request.data;

  if (request.headers) {
    request.headers = Object.fromEntries(
      Object.entries(request.headers).filter(([name]) => !SENSITIVE_HEADER.test(name))
    );
  }

  if (typeof request.query_string === 'string' && request.query_string) {
    const filtered = new URLSearchParams();
    for (const [name, value] of new URLSearchParams(request.query_string)) {
      filtered.append(name, SENSITIVE_QUERY_PARAM.test(name) ? '[Filtered]' : value);
    }
    request.query_string = filtered.toString();
  }

  return event;
}
