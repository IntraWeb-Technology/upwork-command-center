import { describe, expect, it, vi } from 'vitest';

import { uuidv7 } from '@/server/runs/ids';
import { setupTestDatabase } from '@/test/integration/database';
import {
  callbackRequest,
  handlerDeps,
  postCallback,
  proposalInput,
  startRun,
  TEST_CALLBACK_TOKEN,
  TEST_CALLBACK_URL
} from '@/test/integration/runs';

import { handleN8nCallback, MAX_CALLBACK_BYTES } from './callback-handler';
import { buildFakeCallback } from './fake-transport';

const testDb = setupTestDatabase();

async function rawRow(id: string): Promise<string> {
  const result = await testDb.pool.query<{ row: string }>(
    'select row_to_json(w)::text as row from workflow_runs w where id = $1',
    [id]
  );
  return result.rows[0].row;
}

async function runningRun() {
  const started = await startRun(testDb.db, 'ack');
  return { ...started, before: await rawRow(started.run.id) };
}

describe('shared bearer token', () => {
  it.each([
    ['missing', null],
    ['wrong, same length', TEST_CALLBACK_TOKEN.replace(/.$/, '!')],
    ['wrong, different length', 'short']
  ])('rejects a %s bearer token with 401', async (_label, bearer) => {
    const { run, request, before } = await runningRun();
    const response = await postCallback(testDb.db, buildFakeCallback(request, 'succeeded'), {
      bearer
    });
    expect(response).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await rawRow(run.id)).toBe(before);
  });

  it('rejects every callback when N8N_CALLBACK_TOKEN is not configured', async () => {
    const { run, request, before } = await runningRun();
    const response = await postCallback(testDb.db, buildFakeCallback(request, 'succeeded'), {
      deps: { callbackToken: undefined }
    });
    expect(response.status).toBe(401);
    expect(await rawRow(run.id)).toBe(before);
  });
});

describe('per-run callback token', () => {
  it.each([
    [
      'wrong, same length',
      (token: string) => `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    ],
    ['wrong, different length', (token: string) => `${token}-extra-characters`],
    ['wrong, much shorter', () => 'x'.repeat(32)]
  ])('rejects a %s token with 403 and no state change', async (_label, mutate) => {
    const { run, request, before } = await runningRun();
    const callback = buildFakeCallback(request, 'succeeded');
    callback.callback_token = mutate(request.callback.token);

    const response = await postCallback(testDb.db, callback);
    expect(response).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect(await rawRow(run.id)).toBe(before);
  });

  it('answers an unknown run exactly like a wrong token', async () => {
    const { request } = await runningRun();
    const unknownUuid = { ...buildFakeCallback(request, 'succeeded'), run_id: uuidv7() };
    const notAUuid = { ...buildFakeCallback(request, 'succeeded'), run_id: 'run_not_a_uuid' };

    expect(await postCallback(testDb.db, unknownUuid)).toEqual({
      status: 403,
      body: { error: 'forbidden' }
    });
    expect(await postCallback(testDb.db, notAUuid)).toEqual({
      status: 403,
      body: { error: 'forbidden' }
    });
  });
});

describe('contract validation', () => {
  it('rejects a callback whose contract does not match the run', async () => {
    const { run, request } = await runningRun();
    const proposal = await startRun(testDb.db, 'ack', proposalInput());
    const wrongContract = {
      ...buildFakeCallback(proposal.request, 'succeeded'),
      run_id: run.id,
      callback_token: request.callback.token
    };

    const response = await postCallback(testDb.db, wrongContract);
    expect(response).toEqual({ status: 400, body: { error: 'invalid_payload' } });

    const stored = await testDb.pool.query(
      'select status, error_code, error_stage, error_message, result from workflow_runs where id = $1',
      [run.id]
    );
    expect(stored.rows[0]).toEqual({
      status: 'failed',
      error_code: 'INTERNAL',
      error_stage: 'callback',
      error_message: 'Callback contract does not match the run contract',
      result: null
    });

    const correct = await postCallback(testDb.db, buildFakeCallback(request, 'succeeded'));
    expect(correct.body).toEqual({ ok: true, duplicate: true });
  });

  it('rejects a payload that fails the contract schema without storing its values', async () => {
    const { run, request } = await runningRun();
    const callback = buildFakeCallback(request, 'succeeded');
    const versions = callback.versions as Record<string, unknown>;
    delete versions.workflow;
    callback.unexpected_secret_field = 'synthetic-value-that-must-not-be-stored';

    const response = await postCallback(testDb.db, callback);
    expect(response).toEqual({ status: 400, body: { error: 'invalid_payload' } });

    const row = await rawRow(run.id);
    expect(row).not.toContain('synthetic-value-that-must-not-be-stored');
    const stored = await testDb.pool.query<{ status: string; error_message: string }>(
      'select status, error_message from workflow_runs where id = $1',
      [run.id]
    );
    expect(stored.rows[0].status).toBe('failed');
    expect(stored.rows[0].error_message).toContain('versions.workflow');
  });

  it.each([
    ['invalid JSON', '{"run_id": '],
    ['a JSON array', '[]'],
    [
      'a missing run_id',
      JSON.stringify({ callback_token: 'x'.repeat(40), contract: 'ujh.analyze.v1' })
    ]
  ])('rejects %s with 400 before touching any run', async (_label, body) => {
    const { run, before } = await runningRun();
    const response = await postCallback(testDb.db, body);
    expect(response).toEqual({ status: 400, body: { error: 'invalid_payload' } });
    expect(await rawRow(run.id)).toBe(before);
  });
});

describe('body size limit', () => {
  it('rejects a declared Content-Length above 512 KB before reading the body', async () => {
    const { run, before } = await runningRun();
    const oversized = '{' + 'x'.repeat(MAX_CALLBACK_BYTES);
    const response = await handleN8nCallback(
      callbackRequest(oversized, { headers: { 'content-length': String(oversized.length) } }),
      handlerDeps(testDb.db)
    );
    expect(response.status).toBe(413);
    expect(await rawRow(run.id)).toBe(before);
  });

  it('rejects an oversized declared length even without a valid bearer token', async () => {
    const response = await handleN8nCallback(
      callbackRequest('{}', {
        bearer: null,
        headers: { 'content-length': String(MAX_CALLBACK_BYTES + 1) }
      }),
      handlerDeps(testDb.db)
    );
    expect(response.status).toBe(413);
  });

  it.each([
    ['without Content-Length', undefined],
    ['with an understated Content-Length', '2']
  ])('stops reading a streamed body above 512 KB %s', async (_label, declared) => {
    const { run, before } = await runningRun();
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        // An endless stream: the handler must stop on its own.
        controller.enqueue(chunk);
      }
    });
    const request = new Request(TEST_CALLBACK_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_CALLBACK_TOKEN}`,
        ...(declared ? { 'content-length': declared } : {})
      },
      body,
      duplex: 'half'
    } as RequestInit & { duplex: 'half' });

    const response = await handleN8nCallback(request, handlerDeps(testDb.db));
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(20);
    expect(await rawRow(run.id)).toBe(before);
  });

  it('accepts a body of exactly 512 KB as far as the size check is concerned', async () => {
    const exact = 'x'.repeat(MAX_CALLBACK_BYTES);
    const response = await handleN8nCallback(
      callbackRequest(exact, { headers: { 'content-length': String(exact.length) } }),
      handlerDeps(testDb.db)
    );
    expect(response.status).toBe(400);
  });
});

describe('transactional persistence', () => {
  it('rolls back the status change when persisting callback records fails', async () => {
    const { run, request, before } = await runningRun();
    const callback = buildFakeCallback(request, 'succeeded');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handleN8nCallback(callbackRequest(callback), {
      ...handlerDeps(testDb.db),
      materialize: async () => {
        throw new Error('simulated domain write failure');
      }
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    expect(await rawRow(run.id)).toBe(before);
    expect(consoleError).toHaveBeenCalledWith('[runs] callback_processing_failed', {
      run_id: run.id,
      contract: 'ujh.analyze.v1',
      error: 'callback_processing_failed: Error'
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(request.callback.token);

    let materialized = 0;
    const retried = await handleN8nCallback(callbackRequest(callback), {
      ...handlerDeps(testDb.db),
      materialize: async (tx, materializedRun, envelope) => {
        expect(materializedRun.id).toBe(run.id);
        expect(envelope.status).toBe('succeeded');
        expect(tx).toBeDefined();
        materialized += 1;
      }
    });
    expect(retried.status).toBe(200);
    expect(materialized).toBe(1);
  });
});
