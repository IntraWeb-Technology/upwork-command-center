// Synthetic credentials of the local compose database (compose.yaml); CI sets its own.
const LOCAL_TEST_DATABASE_URL = 'postgres://ucc:ucc_local_only@127.0.0.1:54329/ucc_test';

/**
 * Integration tests drop and recreate the schema, so they refuse to run against any
 * database whose name does not end in `_test`.
 */
export function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL || LOCAL_TEST_DATABASE_URL;
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests: database "${name}" does not end in "_test".`
    );
  }
  return url;
}
