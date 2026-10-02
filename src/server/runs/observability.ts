import * as Sentry from '@sentry/nextjs';

interface RunContext {
  runId: string | null;
  contract: string | null;
}

// Only identifiers are reported: never tokens, database URLs, listings, or proposal bodies.
// Sentry calls are no-ops when Sentry is not initialized.

/**
 * Error messages are not safe to forward: Drizzle query errors embed SQL parameters
 * (result payloads, token digests) and connection errors can name the database host.
 * Keeps the error name, a Postgres/Node error code, and the stack frames only.
 */
export function sanitizeError(event: string, error: unknown): Error {
  const name = error instanceof Error ? error.name : 'NonError';
  const code = errorCode(error);
  const sanitized = new Error(`${event}: ${name}${code ? ` (${code})` : ''}`);
  if (error instanceof Error && error.stack) {
    const frames = error.stack.split('\n').filter((line) => /^\s+at\s/.test(line));
    sanitized.stack = [`Error: ${sanitized.message}`, ...frames].join('\n');
  }
  return sanitized;
}

function errorCode(error: unknown): string | null {
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
  }
  return null;
}

export function reportRunError(event: string, error: unknown, context: RunContext): void {
  const sanitized = sanitizeError(event, error);
  console.error(`[runs] ${event}`, {
    run_id: context.runId,
    contract: context.contract,
    error: sanitized.message
  });
  Sentry.withScope((scope) => {
    scope.setTags({ run_id: context.runId ?? 'unknown', contract: context.contract ?? 'unknown' });
    scope.setTag('run_event', event);
    Sentry.captureException(sanitized);
  });
}

export function reportRunWarning(event: string, context: RunContext): void {
  console.warn(`[runs] ${event}`, { run_id: context.runId, contract: context.contract });
  Sentry.withScope((scope) => {
    scope.setTags({ run_id: context.runId ?? 'unknown', contract: context.contract ?? 'unknown' });
    scope.setTag('run_event', event);
    Sentry.captureMessage(`runs: ${event}`, 'warning');
  });
}
