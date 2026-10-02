import { randomBytes } from 'node:crypto';

// Synthetic credentials of the local compose database (compose.yaml); CI sets its own.
const LOCAL_TEST_DATABASE_URL = 'postgres://ucc:ucc_local_only@127.0.0.1:54329/ucc_test';

/** A run database older than this is treated as abandoned by a crashed run. */
export const STALE_RUN_DATABASE_MS = 2 * 60 * 60 * 1000;

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/**
 * The admin database: integration runs connect here only to create and drop their own
 * run database. Refuses anything whose name does not end in `_test`.
 */
export function resolveAdminDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL || LOCAL_TEST_DATABASE_URL;
  const name = databaseName(url);
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests: database "${name}" does not end in "_test".`
    );
  }
  return url;
}

function runPrefix(adminUrl: string): string {
  return `${databaseName(adminUrl).replace(/_test$/, '')}_r`;
}

/**
 * A unique database per integration run, for example `ucc_r20261002071530a1b2c3_test`.
 * The UTC timestamp lets later runs drop databases abandoned by crashed runs.
 */
export function createRunDatabaseName(adminUrl: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `${runPrefix(adminUrl)}${stamp}${randomBytes(3).toString('hex')}_test`;
}

/** Run databases created from this admin database whose timestamp is older than maxAgeMs. */
export function isStaleRunDatabase(
  adminUrl: string,
  name: string,
  now: Date = new Date(),
  maxAgeMs: number = STALE_RUN_DATABASE_MS
): boolean {
  const prefix = runPrefix(adminUrl);
  if (!name.startsWith(prefix) || !name.endsWith('_test')) return false;
  const match = /^(\d{14})[0-9a-f]{6}_test$/.exec(name.slice(prefix.length));
  if (!match) return false;
  const s = match[1];
  const created = Date.UTC(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)) - 1,
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10)),
    Number(s.slice(10, 12)),
    Number(s.slice(12, 14))
  );
  return now.getTime() - created > maxAgeMs;
}

export function withDatabase(url: string, name: string): string {
  const next = new URL(url);
  next.pathname = `/${encodeURIComponent(name)}`;
  return next.toString();
}
