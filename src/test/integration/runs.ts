import type { AnalyzeRequest, GenerateProposalRequest } from '@/contracts';
import type { Database } from '@/server/db/client';
import { handleN8nCallback, type CallbackHandlerDeps } from '@/server/n8n/callback-handler';
import { createFakeTransport, type FakeScenario } from '@/server/n8n/fake-transport';
import type { DispatchRequest } from '@/server/n8n/transport';
import { dispatchWorkflowRun, type DispatchInput } from '@/server/runs/dispatch';
import { loadFixture } from '@/test/contract-fixtures';

// Synthetic test-only credentials.
export const TEST_CALLBACK_TOKEN = 'test-shared-callback-token-0123456789abcdef';
export const TEST_CALLBACK_URL = 'http://127.0.0.1:3000/api/integrations/n8n/callback';

export function analyzeInput(): DispatchInput {
  const { job, input } = loadFixture('analyze', 'valid', 'request.paste.json') as AnalyzeRequest;
  return { contract: 'ujh.analyze.v1', payload: { job, input } };
}

export function proposalInput(): DispatchInput {
  const {
    contract: _c,
    run_id: _r,
    requested_at: _t,
    callback: _cb,
    ...payload
  } = loadFixture('generate_proposal', 'valid', 'request.initial.json') as GenerateProposalRequest;
  return { contract: 'ujh.generate_proposal.v1', payload };
}

export function callbackRequest(
  body: unknown,
  {
    bearer = TEST_CALLBACK_TOKEN,
    headers = {}
  }: { bearer?: string | null; headers?: Record<string, string> } = {}
): Request {
  return new Request(TEST_CALLBACK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
      ...headers
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

export function handlerDeps(
  db: Database,
  overrides: Partial<CallbackHandlerDeps> = {}
): CallbackHandlerDeps {
  return { getDb: () => db, callbackToken: TEST_CALLBACK_TOKEN, ...overrides };
}

export async function postCallback(
  db: Database,
  body: unknown,
  options: Parameters<typeof callbackRequest>[1] & { deps?: Partial<CallbackHandlerDeps> } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handleN8nCallback(
    callbackRequest(body, options),
    handlerDeps(db, options.deps)
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Dispatches through the fake transport; its callbacks go through the real HTTP handler. */
export async function startRun(
  db: Database,
  scenario: FakeScenario,
  input: DispatchInput = analyzeInput(),
  options: { now?: () => Date; deadlineMs?: number } = {}
) {
  const deliveries: number[] = [];
  const fake = createFakeTransport({
    scenario,
    deliver: async (payload) => {
      const response = await handleN8nCallback(callbackRequest(payload), handlerDeps(db));
      deliveries.push(response.status);
    }
  });
  const result = await dispatchWorkflowRun(
    { db, transport: fake, callbackUrl: TEST_CALLBACK_URL, now: options.now },
    input,
    { deadlineMs: options.deadlineMs }
  );
  const request = fake.requests.at(-1) as DispatchRequest;
  return { ...result, fake, request, deliveries };
}
