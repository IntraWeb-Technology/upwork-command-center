import 'server-only';

import { randomBytes } from 'node:crypto';

import { materializeAnalysisResult } from '@/server/analyses/materialize';
import { getDb } from '@/server/db/client';
import { getServerEnv, type ServerEnv } from '@/server/env';
import { JobDomainError } from '@/server/jobs/errors';

import { handleN8nCallback } from './callback-handler';
import { createFakeTransport, type FakeScenario } from './fake-transport';
import { createRemoteTransport } from './remote-transport';
import type { N8nTransport } from './transport';

export const CALLBACK_PATH = '/api/integrations/n8n/callback';
const DEFAULT_FAKE_DELAY_MS = 2500;

export type N8nMode = 'fake' | 'remote';

/** Unset means remote: the fake transport is never selected implicitly. */
export function resolveN8nMode(env: ServerEnv, nodeEnv = process.env.NODE_ENV): N8nMode {
  const mode = env.N8N_MODE ?? 'remote';
  if (mode === 'fake' && nodeEnv === 'production' && env.N8N_ALLOW_FAKE_IN_PRODUCTION !== 'true') {
    throw new JobDomainError(
      'ANALYSIS_UNAVAILABLE',
      'N8N_MODE=fake is refused in a production build.'
    );
  }
  return mode;
}

export interface AnalysisRuntime {
  mode: N8nMode;
  transport: N8nTransport;
  callbackUrl: string;
}

const FAKE_SCENARIOS: Record<NonNullable<ServerEnv['N8N_FAKE_SCENARIO']>, FakeScenario> = {
  succeeded: 'success',
  hard_filtered: 'success_hard_filtered',
  failed: 'failure'
};

// In-process fake callbacks authenticate like real ones; without a configured shared token a
// random per-process token is used for both sides.
const fakeTokenCache = globalThis as typeof globalThis & { uccFakeCallbackToken?: string };
function fakeCallbackToken(env: ServerEnv): string {
  if (env.N8N_CALLBACK_TOKEN) return env.N8N_CALLBACK_TOKEN;
  fakeTokenCache.uccFakeCallbackToken ??= randomBytes(32).toString('base64url');
  return fakeTokenCache.uccFakeCallbackToken;
}

/**
 * Fake n8n for tests and explicit local development. It acknowledges like n8n, then, after a
 * short delay, posts a fixture-based callback through the real callback handler, which
 * authenticates, validates, and materializes it exactly as for a real workflow.
 */
function createRuntimeFakeTransport(env: ServerEnv): N8nTransport {
  const token = fakeCallbackToken(env);
  const delayMs = env.N8N_FAKE_DELAY_MS ?? DEFAULT_FAKE_DELAY_MS;
  return {
    async dispatch(request) {
      const fake = createFakeTransport({
        scenario: FAKE_SCENARIOS[env.N8N_FAKE_SCENARIO ?? 'succeeded'],
        deliver: async (payload) => {
          const response = await handleN8nCallback(
            new Request(request.callback.url, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
              body: JSON.stringify(payload)
            }),
            { getDb, callbackToken: token, materialize: materializeAnalysisResult }
          );
          if (!response.ok) {
            console.error('[fake-n8n] callback was not accepted', { status: response.status });
          }
        }
      });
      const outcome = await fake.dispatch(request);
      setTimeout(() => {
        fake.flush().catch((error: unknown) => {
          console.error('[fake-n8n] callback delivery failed', {
            name: error instanceof Error ? error.name : 'unknown'
          });
        });
      }, delayMs);
      return outcome;
    }
  };
}

/**
 * Transport and callback URL for starting a run. Throws ANALYSIS_UNAVAILABLE (HTTP 503) when
 * the selected mode is not configured; nothing here runs for pages or other routes.
 */
export function getAnalysisRuntime(requestOrigin: string): AnalysisRuntime {
  const env = getServerEnv();
  const mode = resolveN8nMode(env);
  if (mode === 'fake') {
    const base = env.APP_BASE_URL ?? requestOrigin;
    return {
      mode,
      transport: createRuntimeFakeTransport(env),
      callbackUrl: new URL(CALLBACK_PATH, base).toString()
    };
  }
  if (!env.N8N_BASE_URL || !env.N8N_WEBHOOK_TOKEN || !env.APP_BASE_URL) {
    throw new JobDomainError(
      'ANALYSIS_UNAVAILABLE',
      'N8N_BASE_URL, N8N_WEBHOOK_TOKEN, and APP_BASE_URL are required in remote mode.'
    );
  }
  return {
    mode,
    transport: createRemoteTransport({
      baseUrl: env.N8N_BASE_URL,
      webhookToken: env.N8N_WEBHOOK_TOKEN
    }),
    callbackUrl: new URL(CALLBACK_PATH, env.APP_BASE_URL).toString()
  };
}
