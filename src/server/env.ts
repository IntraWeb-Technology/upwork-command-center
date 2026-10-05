import 'server-only';
import { z } from 'zod';

const requiredString = (rule: string) =>
  z.string({
    error: (issue) => (issue.input === undefined ? 'is required' : `must be ${rule}`)
  });

const optionalUrl = z.url({ error: 'must be a valid URL' }).optional();
const optionalPostgresUrl = z
  .url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' })
  .optional();
const optionalToken = z.string().min(32, { error: 'must be at least 32 characters' }).optional();

const serverEnvSchema = z.object({
  // Required now (Foundation).
  CLERK_SECRET_KEY: requiredString('a Clerk secret key').startsWith('sk_', {
    error: 'must be a Clerk secret key (sk_...)'
  }),
  OWNER_CLERK_USER_ID: requiredString('a Clerk user ID').startsWith('user_', {
    error: 'must be a Clerk user ID (user_...)'
  }),

  // Validated at startup when present, but required only by the code paths that use them
  // (see requireServerEnv), so auth-only pages keep working without a database or n8n.
  DATABASE_URL: optionalPostgresUrl,
  DATABASE_URL_DIRECT: optionalPostgresUrl,
  N8N_BASE_URL: optionalUrl,
  N8N_WEBHOOK_TOKEN: optionalToken,
  N8N_CALLBACK_TOKEN: optionalToken,
  // Public origin of this app; n8n posts callbacks to <APP_BASE_URL>/api/integrations/n8n/callback.
  APP_BASE_URL: optionalUrl,
  // Transport selection (src/server/n8n/runtime.ts). Unset means remote; fake is opt-in.
  N8N_MODE: z.enum(['fake', 'remote'], { error: 'must be "fake" or "remote"' }).optional(),
  N8N_FAKE_SCENARIO: z
    .enum(['succeeded', 'hard_filtered', 'failed'], {
      error: 'must be "succeeded", "hard_filtered", or "failed"'
    })
    .optional(),
  N8N_FAKE_DELAY_MS: z.coerce
    .number({ error: 'must be a number of milliseconds' })
    .int({ error: 'must be a whole number of milliseconds' })
    .min(0)
    .max(60_000)
    .optional(),
  // Fake mode is refused in production builds unless this is "true" (CI end-to-end tests only).
  N8N_ALLOW_FAKE_IN_PRODUCTION: z
    .enum(['true', 'false'], { error: 'must be "true" or "false"' })
    .optional()
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

type OptionalServerEnvKey = {
  [K in keyof ServerEnv]-?: undefined extends ServerEnv[K] ? K : never;
}[keyof ServerEnv];

export class ServerEnvError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid server environment:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ServerEnvError';
    this.problems = problems;
  }
}

/**
 * Validates server environment variables. Empty strings count as unset.
 * Error messages name the variable and the rule, never the value.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const input = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== '')
  );
  const result = serverEnvSchema.safeParse(input);
  if (result.success) return result.data;

  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`
  );
  throw new ServerEnvError(problems);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

/** Returns an optional variable that a specific feature cannot work without. */
export function requireServerEnv<K extends OptionalServerEnvKey>(
  key: K,
  env: ServerEnv = getServerEnv()
): NonNullable<ServerEnv[K]> {
  const value = env[key];
  if (value === undefined) throw new ServerEnvError([`${key} is required for this feature`]);
  return value as NonNullable<ServerEnv[K]>;
}
