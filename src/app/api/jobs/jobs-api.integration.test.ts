import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import type {
  CreateJobResponse,
  JobDetail,
  JobListResponse,
  WorkflowRunView
} from '@/features/jobs/api/types';
import { setupTestDatabase } from '@/test/integration/database';
import { FIXTURE_LISTING } from '@/test/integration/jobs';

// Only Clerk's session lookup is replaced; owner authorization itself is the real code.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: session.userId }) }));

const OWNER = 'user_test_owner_synthetic';
const BASE = 'http://127.0.0.1:3000';

setupTestDatabase();

const jobsRoute = await import('./route');
const jobRoute = await import('./[id]/route');
const analysesRoute = await import('./[id]/analyses/route');
const listingsRoute = await import('./[id]/listings/route');
const transitionsRoute = await import('./[id]/transitions/route');
const overrideRoute = await import('./[id]/override/route');
const runRoute = await import('../workflow-runs/[id]/route');

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function request(path: string, method = 'GET', body?: unknown): Request {
  if (body === undefined) return new Request(`${BASE}${path}`, { method });
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`${BASE}${path}`, init);
}

async function read<T>(response: Response): Promise<{ status: number; body: T }> {
  return { status: response.status, body: (await response.json()) as T };
}

async function createJob(analyze = false) {
  return read<CreateJobResponse>(
    await jobsRoute.POST(
      request('/api/jobs', 'POST', {
        title: 'Synthetic: extend a Next.js admin dashboard',
        url: '',
        listing_text: FIXTURE_LISTING,
        analyze
      })
    )
  );
}

async function waitForRun(runId: string): Promise<WorkflowRunView> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { body } = await read<WorkflowRunView>(
      await runRoute.GET(request(`/api/workflow-runs/${runId}`), context(runId))
    );
    if (body.stored_status === 'succeeded' || body.stored_status === 'failed') return body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('run did not finish');
}

// The integration config unstubs env after every test, so stubs are applied per test.
beforeEach(() => {
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_synthetic_for_integration_tests');
  vi.stubEnv('OWNER_CLERK_USER_ID', OWNER);
  vi.stubEnv('DATABASE_URL', inject('testDatabaseUrl'));
  vi.stubEnv('N8N_MODE', 'fake');
  vi.stubEnv('N8N_FAKE_DELAY_MS', '20');
  vi.stubEnv('N8N_FAKE_SCENARIO', 'succeeded');
  session.userId = OWNER;
});

afterAll(async () => {
  const cache = globalThis as typeof globalThis & {
    uccDatabaseCache?: { pool: { end: () => Promise<void> } };
  };
  await cache.uccDatabaseCache?.pool.end();
  delete cache.uccDatabaseCache;
});

describe('jobs API authorization', () => {
  it('returns 401 when signed out and 403 for another account on every endpoint', async () => {
    const id = '01920000-0000-7000-8000-000000000000';
    const calls = [
      () => jobsRoute.GET(request('/api/jobs')),
      () => jobsRoute.POST(request('/api/jobs', 'POST', {})),
      () => jobRoute.GET(request(`/api/jobs/${id}`), context(id)),
      () => analysesRoute.POST(request(`/api/jobs/${id}/analyses`, 'POST'), context(id)),
      () => listingsRoute.POST(request(`/api/jobs/${id}/listings`, 'POST', {}), context(id)),
      () => transitionsRoute.POST(request(`/api/jobs/${id}/transitions`, 'POST', {}), context(id)),
      () => overrideRoute.PUT(request(`/api/jobs/${id}/override`, 'PUT', {}), context(id)),
      () => runRoute.GET(request(`/api/workflow-runs/${id}`), context(id))
    ];
    for (const [userId, status] of [
      [null, 401],
      ['user_someone_else', 403]
    ] as const) {
      session.userId = userId;
      for (const call of calls) expect((await call()).status).toBe(status);
    }
  });
});

describe('jobs API', () => {
  it('creates a job without analysis and reads it back', async () => {
    const created = await createJob(false);
    expect(created.status).toBe(201);
    expect(created.body.run).toBeNull();
    expect(created.body.job).toMatchObject({
      stage: 'reviewing',
      listing: { text: FIXTURE_LISTING },
      analysis: null,
      can_analyze: true
    });

    const id = created.body.job.id;
    const detail = await read<JobDetail>(
      await jobRoute.GET(request(`/api/jobs/${id}`), context(id))
    );
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(id);

    const list = await read<JobListResponse>(await jobsRoute.GET(request('/api/jobs?perPage=5')));
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ id, analysis_status: null });
  });

  it('creates, analyzes through the fake transport, and returns the analysis', async () => {
    const created = await createJob(true);
    expect(created.status).toBe(201);
    const run = created.body.run as WorkflowRunView;
    expect(run).toMatchObject({ stored_status: 'running', effective_status: 'running' });
    expect(Object.keys(run).toSorted()).toEqual(
      [
        'contract',
        'deadline_at',
        'effective_status',
        'error',
        'finished_at',
        'id',
        'requested_at',
        'started_at',
        'stored_status'
      ].toSorted()
    );

    expect((await waitForRun(run.id)).stored_status).toBe('succeeded');
    const id = created.body.job.id;
    const { body } = await read<JobDetail>(
      await jobRoute.GET(request(`/api/jobs/${id}`), context(id))
    );
    expect(body.analysis).toMatchObject({ system_score: 7.8, system_disposition: 'REVIEW' });
    expect(body.analysis?.scores).toHaveLength(7);
    expect(body.timeline.map((entry) => entry.type)).toEqual([
      'JOB_CREATED',
      'LISTING_ADDED',
      'ANALYSIS_STARTED',
      'ANALYZED'
    ]);
  });

  it('starts a re-analysis with 202 and refuses a concurrent one with 409', async () => {
    const { body: created } = await createJob(false);
    const id = created.job.id;
    const first = await read<{ run: WorkflowRunView }>(
      await analysesRoute.POST(request(`/api/jobs/${id}/analyses`, 'POST'), context(id))
    );
    expect(first.status).toBe(202);
    const second = await read<{ error: { code: string; run_id?: string } }>(
      await analysesRoute.POST(request(`/api/jobs/${id}/analyses`, 'POST'), context(id))
    );
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: 'ACTIVE_RUN', run_id: first.body.run.id });
    await waitForRun(first.body.run.id);
  });

  it('validates input with field paths and never echoes values', async () => {
    const invalid = await read<{ error: { code: string; fields: Record<string, string> } }>(
      await jobsRoute.POST(
        request('/api/jobs', 'POST', { title: '', url: 'javascript:alert(1)', listing_text: '' })
      )
    );
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.error.fields).toSorted()).toEqual([
      'listing_text',
      'title',
      'url'
    ]);
    expect(JSON.stringify(invalid.body)).not.toContain('javascript');

    expect((await jobsRoute.POST(request('/api/jobs', 'POST', 'not json'))).status).toBe(400);

    const { body: created } = await createJob(false);
    const id = created.job.id;
    const decline = await transitionsRoute.POST(
      request(`/api/jobs/${id}/transitions`, 'POST', { to_stage: 'declined', reason: '' }),
      context(id)
    );
    expect(decline.status).toBe(400);
    const override = await overrideRoute.PUT(
      request(`/api/jobs/${id}/override`, 'PUT', { manual_score: 11 }),
      context(id)
    );
    expect(override.status).toBe(400);
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const unknown = '01920000-0000-7000-8000-000000000000';
    for (const id of [unknown, 'not-a-uuid']) {
      expect((await jobRoute.GET(request(`/api/jobs/${id}`), context(id))).status).toBe(404);
      expect(
        (await analysesRoute.POST(request(`/api/jobs/${id}/analyses`, 'POST'), context(id))).status
      ).toBe(404);
      expect((await runRoute.GET(request(`/api/workflow-runs/${id}`), context(id))).status).toBe(
        404
      );
    }
  });

  it('declines, overrides, and adds snapshots through the API', async () => {
    const created = await createJob(true);
    await waitForRun((created.body.run as WorkflowRunView).id);
    const id = created.body.job.id;

    const override = await read<JobDetail>(
      await overrideRoute.PUT(
        request(`/api/jobs/${id}/override`, 'PUT', {
          manual_score: 8.5,
          manual_disposition: 'PRIORITY',
          reason: 'Strong referral'
        }),
        context(id)
      )
    );
    expect(override.status).toBe(200);
    expect(override.body).toMatchObject({ final_score: 8.5, final_disposition: 'PRIORITY' });

    const same = await listingsRoute.POST(
      request(`/api/jobs/${id}/listings`, 'POST', { listing_text: `${FIXTURE_LISTING}\n` }),
      context(id)
    );
    expect(same.status).toBe(200);
    const changed = await listingsRoute.POST(
      request(`/api/jobs/${id}/listings`, 'POST', { listing_text: `${FIXTURE_LISTING} More.` }),
      context(id)
    );
    expect(changed.status).toBe(201);

    const declined = await read<JobDetail>(
      await transitionsRoute.POST(
        request(`/api/jobs/${id}/transitions`, 'POST', {
          to_stage: 'declined',
          reason: 'Timeline too short'
        }),
        context(id)
      )
    );
    expect(declined.body).toMatchObject({
      stage: 'declined',
      close_reason: 'Timeline too short',
      can_analyze: false,
      can_decline: false
    });
    const again = await analysesRoute.POST(
      request(`/api/jobs/${id}/analyses`, 'POST'),
      context(id)
    );
    expect(again.status).toBe(409);
  });

  it('answers 503 without creating a job when remote mode is not configured', async () => {
    vi.stubEnv('N8N_MODE', 'remote');
    const response = await read<{ error: { code: string; message: string } }>(
      await jobsRoute.POST(
        request('/api/jobs', 'POST', { title: 'T', listing_text: FIXTURE_LISTING })
      )
    );
    expect(response.status).toBe(503);
    expect(response.body.error.message).not.toMatch(/N8N|APP_BASE_URL|remote/);
    const list = await read<JobListResponse>(await jobsRoute.GET(request('/api/jobs')));
    expect(list.body.total).toBe(0);
  });

  it('delivers hard-filter and failure scenarios through the real callback path', async () => {
    vi.stubEnv('N8N_FAKE_SCENARIO', 'hard_filtered');
    const filtered = await createJob(true);
    await waitForRun((filtered.body.run as WorkflowRunView).id);
    const filteredId = filtered.body.job.id;
    const filteredDetail = await read<JobDetail>(
      await jobRoute.GET(request(`/api/jobs/${filteredId}`), context(filteredId))
    );
    expect(filteredDetail.body.analysis).toMatchObject({
      hard_filter: { pass: false },
      system_score: null,
      scores: []
    });

    vi.stubEnv('N8N_FAKE_SCENARIO', 'failed');
    const failedJob = await read<CreateJobResponse>(
      await jobsRoute.POST(
        request('/api/jobs', 'POST', { title: 'Second', listing_text: `${FIXTURE_LISTING} 2` })
      )
    );
    const failedRun = await waitForRun((failedJob.body.run as WorkflowRunView).id);
    expect(failedRun).toMatchObject({
      stored_status: 'failed',
      error: { retryable: expect.any(Boolean) }
    });
  });
});
