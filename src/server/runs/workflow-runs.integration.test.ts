import { readFileSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { workflowRuns } from '@/server/db/schema';
import { buildFakeCallback } from '@/server/n8n/fake-transport';
import { setupTestDatabase } from '@/test/integration/database';
import { analyzeInput, postCallback, proposalInput, startRun } from '@/test/integration/runs';

import { hashCallbackToken } from './callback-token';
import { InvalidRunRequestError } from './dispatch';
import {
  createWorkflowRun,
  failWorkflowRun,
  getEffectiveWorkflowRun,
  markDispatchAccepted,
  markDispatchRejected,
  RunStateError
} from './repository';

const testDb = setupTestDatabase();

async function rawRow(id: string): Promise<string> {
  const result = await testDb.pool.query<{ row: string }>(
    'select row_to_json(w)::text as row from workflow_runs w where id = $1',
    [id]
  );
  return result.rows[0].row;
}

async function storedRun(id: string) {
  const [row] = await testDb.db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
  return row;
}

const analyzeSummary = {
  job_id: 'job_1',
  upwork_ref: null,
  source_url: null,
  listing_id: 'lst_1',
  listing_chars: 10,
  listing_sha256: 'a'.repeat(64)
};

describe('migrations', () => {
  it('applies every committed migration to an empty database', async () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: unknown[];
    };
    const applied = await testDb.pool.query('select hash from drizzle.__drizzle_migrations');
    expect(applied.rowCount).toBe(journal.entries.length);

    const enumValues = await testDb.pool.query<{ value: string }>(
      'select unnest(enum_range(null::workflow_run_status))::text as value'
    );
    expect(enumValues.rows.map((row) => row.value)).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed'
    ]);
  });

  it('cannot persist timed_out, an unknown contract, or an inconsistent retry chain', async () => {
    const base = {
      contract: 'ujh.analyze.v1',
      request: analyzeSummary,
      callbackTokenHash: 'a'.repeat(64),
      requestedAt: new Date('2026-01-01T00:00:00Z'),
      deadlineAt: new Date('2026-01-01T00:05:00Z')
    };
    const insert = (values: Record<string, unknown>) =>
      testDb.pool.query(
        `insert into workflow_runs (id, contract, status, request, callback_token_hash, attempt, requested_at, deadline_at)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [
          values.contract ?? base.contract,
          values.status ?? 'queued',
          JSON.stringify(base.request),
          values.callbackTokenHash ?? base.callbackTokenHash,
          values.attempt ?? 1,
          base.requestedAt,
          base.deadlineAt
        ]
      );

    await expect(insert({ status: 'timed_out' })).rejects.toThrow();
    await expect(insert({ contract: 'ujh.health.v1' })).rejects.toThrow();
    await expect(insert({ attempt: 2 })).rejects.toThrow();
    await expect(insert({ callbackTokenHash: 'not-a-digest' })).rejects.toThrow();
    await expect(insert({ status: 'succeeded' })).rejects.toThrow();
  });
});

describe('workflow run creation', () => {
  it('creates a queued first attempt with a derived deadline', async () => {
    const now = new Date('2026-03-01T12:00:00.000Z');
    const { run } = await createWorkflowRun(testDb.db, {
      contract: 'ujh.analyze.v1',
      request: analyzeSummary,
      now
    });

    expect(run).toMatchObject({
      contract: 'ujh.analyze.v1',
      status: 'queued',
      attempt: 1,
      retryOfRunId: null,
      result: null,
      errorCode: null,
      dispatchedAt: null,
      finishedAt: null
    });
    expect(run.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(run.requestedAt.toISOString()).toBe(now.toISOString());
    expect(run.deadlineAt.getTime() - now.getTime()).toBe(5 * 60_000);
    expect(run).not.toHaveProperty('callbackTokenHash');
  });

  it('persists only the SHA-256 digest of the callback token', async () => {
    const { run, callbackToken } = await createWorkflowRun(testDb.db, {
      contract: 'ujh.analyze.v1',
      request: analyzeSummary
    });

    const row = await rawRow(run.id);
    expect(row).not.toContain(callbackToken);
    expect((await storedRun(run.id)).callbackTokenHash).toBe(hashCallbackToken(callbackToken));
  });

  it('stores a sanitized request summary, never the listing, callback URL, or token', async () => {
    const { run, request } = await startRun(testDb.db, 'ack');
    const row = await rawRow(run.id);

    expect(request.contract).toBe('ujh.analyze.v1');
    if (request.contract !== 'ujh.analyze.v1') return;
    expect(row).not.toContain(request.callback.token);
    expect(row).not.toContain(request.callback.url);
    expect(row).not.toContain(request.input.listing_text.slice(0, 40));
    expect(run.request).toMatchObject({
      job_id: request.job.id,
      listing_id: request.input.listing_id,
      listing_chars: request.input.listing_text.length
    });
  });

  it('stores proposal summaries without the listing, base body, or instructions', async () => {
    const { run, request } = await startRun(testDb.db, 'ack', proposalInput());
    if (request.contract !== 'ujh.generate_proposal.v1') throw new Error('wrong contract');

    const row = await rawRow(run.id);
    expect(row).not.toContain(request.listing.text.slice(0, 40));
    expect(run.request).toEqual({
      job_id: request.job.id,
      listing_id: request.listing.id,
      listing_chars: request.listing.text.length,
      analysis_id: request.analysis?.id ?? null,
      base_version_number: request.base_version?.number ?? null,
      has_instructions: request.instructions !== null
    });
  });

  it('rejects an invalid request before anything is persisted or dispatched', async () => {
    const input = analyzeInput();
    if (input.contract !== 'ujh.analyze.v1') throw new Error('wrong contract');
    input.payload.input.listing_text = '   ';

    await expect(startRun(testDb.db, 'ack', input)).rejects.toBeInstanceOf(InvalidRunRequestError);
    expect(await testDb.db.select().from(workflowRuns)).toHaveLength(0);
  });
});

describe('callbacks', () => {
  it('accepts a success callback for a queued run', async () => {
    const { run, request } = await startRun(testDb.db, 'ambiguous');
    expect(run.status).toBe('queued');

    const response = await postCallback(testDb.db, buildFakeCallback(request, 'succeeded'));
    expect(response).toEqual({ status: 200, body: { ok: true } });

    const stored = await storedRun(run.id);
    expect(stored.status).toBe('succeeded');
    expect(stored.finishedAt).toBeInstanceOf(Date);
    expect(stored.n8nExecutionRef).toBe(`fake-${run.id.slice(0, 8)}`);
    expect(stored.result).toMatchObject({
      versions: { workflow: expect.any(String) },
      models: { extraction: expect.any(Object) },
      result: { hard_filter: expect.any(Object) }
    });
    expect(stored.errorCode).toBeNull();
  });

  it('accepts a success callback for a running run', async () => {
    const { run, request } = await startRun(testDb.db, 'ack');
    expect(run.status).toBe('running');
    expect(run.dispatchedAt).toBeInstanceOf(Date);

    const response = await postCallback(testDb.db, buildFakeCallback(request, 'succeeded'));
    expect(response.status).toBe(200);
    expect((await storedRun(run.id)).status).toBe('succeeded');
  });

  it.each(['ambiguous', 'ack'] as const)(
    'accepts a failure callback (dispatch scenario %s)',
    async (scenario) => {
      const { run, request } = await startRun(testDb.db, scenario);
      expect(run.status).toBe(scenario === 'ack' ? 'running' : 'queued');

      const callback = buildFakeCallback(request, 'failed');
      const response = await postCallback(testDb.db, callback);
      expect(response).toEqual({ status: 200, body: { ok: true } });

      const stored = await storedRun(run.id);
      const error = callback.error as {
        code: string;
        stage: string;
        message: string;
        retryable: boolean;
      };
      expect(stored).toMatchObject({
        status: 'failed',
        errorCode: error.code,
        errorStage: error.stage,
        errorMessage: error.message,
        retryable: error.retryable,
        result: null
      });
      expect(stored.finishedAt).toBeInstanceOf(Date);
    }
  );

  it('delivers success and failure callbacks through the fake transport', async () => {
    const succeeded = await startRun(testDb.db, 'success', proposalInput());
    await succeeded.fake.flush();
    expect(succeeded.deliveries).toEqual([200]);
    expect((await storedRun(succeeded.run.id)).status).toBe('succeeded');

    const failed = await startRun(testDb.db, 'failure');
    await failed.fake.flush();
    expect((await storedRun(failed.run.id)).status).toBe('failed');
  });

  it.each(['succeeded', 'failed'] as const)(
    'treats a duplicate %s callback as idempotent',
    async (status) => {
      const { run, request } = await startRun(testDb.db, 'ack');
      const callback = buildFakeCallback(request, status);

      await postCallback(testDb.db, callback);
      const afterFirst = await rawRow(run.id);

      const duplicate = await postCallback(testDb.db, callback);
      expect(duplicate).toEqual({ status: 200, body: { ok: true, duplicate: true } });

      const opposite = buildFakeCallback(request, status === 'succeeded' ? 'failed' : 'succeeded');
      const conflicting = await postCallback(testDb.db, opposite);
      expect(conflicting).toEqual({ status: 200, body: { ok: true, duplicate: true } });

      expect(await rawRow(run.id)).toBe(afterFirst);
    }
  );

  it('does not let a late acknowledgement overwrite a callback that arrived first', async () => {
    const { run, deliveries } = await startRun(testDb.db, 'callback_before_ack');
    expect(deliveries).toEqual([200]);
    expect(run.status).toBe('succeeded');
    expect(run.dispatchedAt).toBeNull();

    const before = await rawRow(run.id);
    expect(await markDispatchAccepted(testDb.db, run.id, { executionRef: 'late' })).toBe(false);
    expect(await rawRow(run.id)).toBe(before);
  });
});

describe('dispatch outcomes', () => {
  it('fails a queued run when n8n explicitly rejects the input', async () => {
    const { run, outcome } = await startRun(testDb.db, 'reject');
    expect(outcome.type).toBe('rejected');
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_INPUT',
      errorStage: 'dispatch',
      retryable: false
    });
  });

  it('fails a queued run as retryable when n8n is unavailable', async () => {
    const { run } = await startRun(testDb.db, 'unavailable');
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'UPSTREAM_UNAVAILABLE',
      retryable: true
    });
  });

  it('only rejects runs that are still queued', async () => {
    const { run } = await startRun(testDb.db, 'ack');
    const failure = {
      code: 'UPSTREAM_UNAVAILABLE' as const,
      stage: 'dispatch',
      message: 'x',
      retryable: true
    };
    expect(await markDispatchRejected(testDb.db, run.id, failure)).toBe(false);
    expect((await storedRun(run.id)).status).toBe('running');
  });

  it('leaves the run queued when the dispatch outcome is ambiguous', async () => {
    const { run, outcome } = await startRun(testDb.db, 'ambiguous');
    expect(outcome).toEqual({ type: 'ambiguous', reason: 'timeout' });
    expect(run).toMatchObject({
      status: 'queued',
      dispatchedAt: null,
      finishedAt: null,
      errorCode: null
    });
  });
});

describe('effective timeout', () => {
  const requestedAt = new Date('2026-01-01T00:00:00.000Z');

  it('derives timed_out after the deadline without writing to the database', async () => {
    const { run } = await createWorkflowRun(testDb.db, {
      contract: 'ujh.analyze.v1',
      request: analyzeSummary,
      now: requestedAt
    });
    const before = await rawRow(run.id);

    const atDeadline = await getEffectiveWorkflowRun(testDb.db, run.id, run.deadlineAt);
    expect(atDeadline?.effectiveStatus).toBe('queued');

    const afterDeadline = new Date(run.deadlineAt.getTime() + 1);
    const late = await getEffectiveWorkflowRun(testDb.db, run.id, afterDeadline);
    expect(late?.effectiveStatus).toBe('timed_out');
    expect(late?.status).toBe('queued');
    expect(late).not.toHaveProperty('callbackTokenHash');

    expect(await rawRow(run.id)).toBe(before);
  });

  it('accepts a valid callback after the effective timeout', async () => {
    const { run, request } = await startRun(testDb.db, 'ack', analyzeInput(), {
      now: () => requestedAt
    });
    expect((await getEffectiveWorkflowRun(testDb.db, run.id))?.effectiveStatus).toBe('timed_out');

    const response = await postCallback(testDb.db, buildFakeCallback(request, 'succeeded'));
    expect(response.status).toBe(200);

    const effective = await getEffectiveWorkflowRun(testDb.db, run.id);
    expect(effective?.effectiveStatus).toBe('succeeded');
    expect(effective!.finishedAt!.getTime()).toBeGreaterThan(effective!.deadlineAt.getTime());
  });
});

describe('retries', () => {
  it('never resurrects a run that was failed before a retry', async () => {
    const { run, request } = await startRun(testDb.db, 'ack');
    const timeout = {
      code: 'TIMEOUT' as const,
      stage: null,
      message: 'Run timed out',
      retryable: true
    };

    const retry = await testDb.db.transaction(async (tx) => {
      expect(await failWorkflowRun(tx, run.id, timeout)).toBe(true);
      return createWorkflowRun(tx, {
        contract: 'ujh.analyze.v1',
        request: run.request as typeof analyzeSummary,
        retryOfRunId: run.id
      });
    });
    expect(retry.run).toMatchObject({ attempt: 2, retryOfRunId: run.id, status: 'queued' });

    const before = await rawRow(run.id);
    const late = await postCallback(testDb.db, buildFakeCallback(request, 'succeeded'));
    expect(late).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(await rawRow(run.id)).toBe(before);
    expect((await storedRun(run.id)).errorCode).toBe('TIMEOUT');

    expect(await failWorkflowRun(testDb.db, run.id, timeout)).toBe(false);
  });

  it('refuses to retry a run twice or to retry a run that has not failed', async () => {
    const { run } = await startRun(testDb.db, 'reject');
    const retryInput = {
      contract: 'ujh.analyze.v1' as const,
      request: run.request as typeof analyzeSummary,
      retryOfRunId: run.id
    };
    await createWorkflowRun(testDb.db, retryInput);
    await expect(createWorkflowRun(testDb.db, retryInput)).rejects.toMatchObject({
      code: 'CONFLICT'
    });

    const active = await startRun(testDb.db, 'ack');
    await expect(
      createWorkflowRun(testDb.db, { ...retryInput, retryOfRunId: active.run.id })
    ).rejects.toBeInstanceOf(RunStateError);
  });
});
