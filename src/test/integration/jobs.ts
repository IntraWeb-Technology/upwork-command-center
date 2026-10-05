import type { AnalyzeRequest } from '@/contracts';
import { materializeAnalysisResult } from '@/server/analyses/materialize';
import { startAnalysis } from '@/server/analyses/start';
import type { Database } from '@/server/db/client';
import { createManualJob } from '@/server/jobs/repository';
import { handleN8nCallback } from '@/server/n8n/callback-handler';
import { createFakeTransport, type FakeScenario } from '@/server/n8n/fake-transport';
import type { DispatchRequest } from '@/server/n8n/transport';
import type { MaterializeCallback } from '@/server/runs/callback';
import { loadFixture } from '@/test/contract-fixtures';

import { callbackRequest, handlerDeps, TEST_CALLBACK_URL } from './runs';

export const FIXTURE_LISTING = (
  loadFixture('analyze', 'valid', 'request.paste.json') as AnalyzeRequest
).input.listing_text;

export function createTestJob(
  db: Database,
  overrides: Partial<Parameters<typeof createManualJob>[1]> = {}
) {
  return createManualJob(db, {
    title: 'Synthetic: extend a Next.js admin dashboard',
    url: null,
    listingText: FIXTURE_LISTING,
    ...overrides
  });
}

/** Posts a callback through the real handler with the analysis materializer. */
export async function deliverAnalyzeCallback(
  db: Database,
  payload: unknown,
  materialize: MaterializeCallback = materializeAnalysisResult
): Promise<number> {
  const response = await handleN8nCallback(
    callbackRequest(payload),
    handlerDeps(db, { materialize })
  );
  return response.status;
}

/** Starts an analysis through the fake transport; queued callbacks are delivered on flush(). */
export async function analyzeJob(
  db: Database,
  jobId: string,
  scenario: FakeScenario = 'success',
  options: { now?: () => Date; materialize?: MaterializeCallback } = {}
) {
  const deliveries: number[] = [];
  const fake = createFakeTransport({
    scenario,
    deliver: async (payload) => {
      deliveries.push(await deliverAnalyzeCallback(db, payload, options.materialize));
    }
  });
  const result = await startAnalysis(
    { db, transport: fake, callbackUrl: TEST_CALLBACK_URL, now: options.now },
    jobId
  );
  const request = fake.requests.at(-1) as DispatchRequest;
  return { ...result, fake, request, deliveries };
}
