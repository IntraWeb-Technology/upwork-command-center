import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  analysisScores,
  configSnapshots,
  jobAnalyses,
  jobEvents,
  jobs,
  workflowRuns
} from '@/server/db/schema';
import { JobDomainError } from '@/server/jobs/errors';
import { getJobDetail } from '@/server/jobs/read-models';
import { addListingSnapshot, overrideAnalysis } from '@/server/jobs/repository';
import { buildFakeCallback } from '@/server/n8n/fake-transport';
import { setupTestDatabase } from '@/test/integration/database';
import {
  analyzeJob,
  createTestJob,
  deliverAnalyzeCallback,
  FIXTURE_LISTING
} from '@/test/integration/jobs';

import { materializeAnalysisResult } from './materialize';

const database = setupTestDatabase();

async function analysesOf(jobId: string) {
  return database.db.select().from(jobAnalyses).where(eq(jobAnalyses.jobId, jobId));
}

async function jobRow(jobId: string) {
  const [row] = await database.db.select().from(jobs).where(eq(jobs.id, jobId));
  return row;
}

async function runRow(runId: string) {
  const [row] = await database.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  return row;
}

function reversed(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).toReversed());
}

async function expectDomainError(promise: Promise<unknown>, code: JobDomainError['code']) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof JobDomainError && error.code === code
  );
}

describe('starting an analysis', () => {
  it('dispatches the current listing as a job-linked run with an ANALYSIS_STARTED event', async () => {
    const { job, listing } = await createTestJob(database.db);
    const { run, outcome, request } = await analyzeJob(database.db, job.id, 'ack');

    expect(outcome.type).toBe('accepted');
    expect(run).toMatchObject({ jobId: job.id, status: 'running', contract: 'ujh.analyze.v1' });
    expect(request).toMatchObject({
      job: { id: job.id, upwork_ref: null, source_url: null },
      input: { listing_id: listing.id, listing_text: FIXTURE_LISTING }
    });
    // The listing is sent to n8n but never stored on the run.
    expect(JSON.stringify((await runRow(run.id)).request)).not.toContain('SYNTHETIC');

    const events = await database.db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id));
    expect(events.find((event) => event.type === 'ANALYSIS_STARTED')).toMatchObject({
      actor: 'owner',
      workflowRunId: run.id,
      payload: { listing_id: listing.id }
    });
  });

  it('prevents a second active run, including under concurrency', async () => {
    const { job } = await createTestJob(database.db);
    await analyzeJob(database.db, job.id, 'ack');
    await expectDomainError(analyzeJob(database.db, job.id, 'ack'), 'ACTIVE_RUN');

    const other = await createTestJob(database.db, { title: 'Concurrent' });
    const results = await Promise.allSettled([
      analyzeJob(database.db, other.job.id, 'ack'),
      analyzeJob(database.db, other.job.id, 'ack'),
      analyzeJob(database.db, other.job.id, 'ack')
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(JobDomainError);
        expect((result.reason as JobDomainError).code).toBe('ACTIVE_RUN');
      }
    }
  });

  it('fails an effectively timed-out run with TIMEOUT before starting a new one', async () => {
    const { job } = await createTestJob(database.db);
    const first = await analyzeJob(database.db, job.id, 'success');
    const later = new Date(first.run.deadlineAt.getTime() + 1000);
    const second = await analyzeJob(database.db, job.id, 'ack', { now: () => later });

    expect(await runRow(first.run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'TIMEOUT',
      retryable: true
    });
    expect(second.run.status).toBe('running');

    // A late callback for the timed-out run is ignored and persists nothing.
    await first.fake.flush();
    expect(first.deliveries).toEqual([200]);
    expect(await analysesOf(job.id)).toHaveLength(0);
  });

  it('allows a new run after a failed one and requires a listing', async () => {
    const { job } = await createTestJob(database.db);
    const failed = await analyzeJob(database.db, job.id, 'failure');
    await failed.fake.flush();
    expect((await runRow(failed.run.id)).status).toBe('failed');
    const again = await analyzeJob(database.db, job.id, 'ack');
    expect(again.run.status).toBe('running');

    await expectDomainError(
      analyzeJob(database.db, '01920000-0000-7000-8000-000000000000'),
      'NOT_FOUND'
    );
  });
});

describe('materializing a successful analysis', () => {
  it('persists the analysis, the full score set, the pointer, and the event with the run', async () => {
    const { job, listing } = await createTestJob(database.db);
    const { run, fake, deliveries } = await analyzeJob(database.db, job.id, 'success');
    await fake.flush();
    expect(deliveries).toEqual([200]);

    const [analysis] = await analysesOf(job.id);
    expect(analysis).toMatchObject({
      listingId: listing.id,
      workflowRunId: run.id,
      extractionStatus: 'ok',
      hardFilterPass: true,
      hardFilterReasons: [],
      systemScore: 7.8,
      systemDisposition: 'REVIEW',
      clientProblem: 'The internal team cannot keep up with reporting requests.',
      extractionModel: 'fixture-extraction-model',
      analysisModel: 'fixture-analysis-model',
      analysisFallbackUsed: false
    });

    const scores = await database.db
      .select()
      .from(analysisScores)
      .where(eq(analysisScores.analysisId, analysis.id));
    expect(scores).toHaveLength(7);
    expect(scores.find((score) => score.dimension === 'technical_fit')).toMatchObject({
      score: 9,
      weight: 0.25,
      evidence: 'Next.js and PostgreSQL are core skills.'
    });
    expect(scores.find((score) => score.dimension === 'budget_score')?.evidence).toBeNull();

    expect(await jobRow(job.id)).toMatchObject({
      currentAnalysisId: analysis.id,
      stage: 'reviewing'
    });
    const storedRun = await runRow(run.id);
    expect(storedRun.status).toBe('succeeded');
    expect(storedRun.result).toEqual({
      completed_at: expect.any(String),
      analysis_id: analysis.id,
      config_snapshot_id: analysis.configSnapshotId
    });
    const analyzed = await database.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.idempotencyKey, `run:${run.id}:ANALYZED`));
    expect(analyzed[0]).toMatchObject({
      actor: 'n8n',
      workflowRunId: run.id,
      payload: { analysis_id: analysis.id, system_score: 7.8, system_disposition: 'REVIEW' }
    });

    const detail = await getJobDetail(database.db, job.id);
    expect(detail?.analysis).toMatchObject({
      system_score: 7.8,
      for_current_listing: true,
      hard_filter: { pass: true, reasons: [] }
    });
    expect(detail?.analysis?.scores.map((score) => score.dimension)[0]).toBe('technical_fit');
    expect(detail?.latest_run?.effective_status).toBe('succeeded');
    expect(detail?.can_analyze).toBe(true);
  });

  it('records a hard-filter rejection as a successful analysis without scores', async () => {
    const { job } = await createTestJob(database.db);
    const { run, fake } = await analyzeJob(database.db, job.id, 'success_hard_filtered');
    await fake.flush();

    const [analysis] = await analysesOf(job.id);
    expect(analysis.hardFilterPass).toBe(false);
    expect(analysis.hardFilterReasons.length).toBeGreaterThan(0);
    expect(analysis).toMatchObject({
      systemScore: null,
      systemDisposition: null,
      analysisModel: null
    });
    expect(
      await database.db
        .select()
        .from(analysisScores)
        .where(eq(analysisScores.analysisId, analysis.id))
    ).toHaveLength(0);
    expect((await runRow(run.id)).status).toBe('succeeded');
    // Not auto-dismissed: the owner decides.
    expect(await jobRow(job.id)).toMatchObject({
      stage: 'reviewing',
      currentAnalysisId: analysis.id
    });
    const [snapshot] = await database.db
      .select()
      .from(configSnapshots)
      .where(eq(configSnapshots.id, analysis.configSnapshotId));
    expect(snapshot.models).toEqual({
      extraction: { model: 'fixture-extraction-model', provider: null },
      analysis: null
    });
  });

  it('records a failed callback on the run only', async () => {
    const { job } = await createTestJob(database.db);
    const { run, fake } = await analyzeJob(database.db, job.id, 'failure');
    await fake.flush();
    expect((await runRow(run.id)).status).toBe('failed');
    expect(await analysesOf(job.id)).toHaveLength(0);
    expect((await jobRow(job.id)).currentAnalysisId).toBeNull();
    const detail = await getJobDetail(database.db, job.id);
    expect(detail?.latest_run).toMatchObject({
      effective_status: 'failed',
      error: { code: expect.any(String) }
    });
  });

  it('rolls back everything, including the run transition, when materialization fails', async () => {
    const { job } = await createTestJob(database.db);
    const { run, fake, deliveries } = await analyzeJob(database.db, job.id, 'success', {
      materialize: async (tx, current, callback) => {
        await materializeAnalysisResult(tx, current, callback);
        throw new Error('simulated persistence failure');
      }
    });
    await fake.flush();

    expect(deliveries).toEqual([500]);
    expect((await runRow(run.id)).status).toBe('running');
    expect(await analysesOf(job.id)).toHaveLength(0);
    expect(await database.db.select().from(analysisScores)).toHaveLength(0);
    expect(await database.db.select().from(configSnapshots)).toHaveLength(0);
    expect((await jobRow(job.id)).currentAnalysisId).toBeNull();
    const events = await database.db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id));
    expect(events.some((event) => event.type === 'ANALYZED')).toBe(false);

    // n8n retrying the same callback then succeeds.
    const retry = buildFakeCallback(fake.requests[0], 'succeeded');
    expect(await deliverAnalyzeCallback(database.db, retry)).toBe(200);
    expect(await analysesOf(job.id)).toHaveLength(1);
  });

  it('ignores a duplicate callback without a second analysis', async () => {
    const { job } = await createTestJob(database.db);
    const { fake } = await analyzeJob(database.db, job.id, 'success');
    await fake.flush();
    const duplicate = buildFakeCallback(fake.requests[0], 'succeeded');
    expect(await deliverAnalyzeCallback(database.db, duplicate)).toBe(200);
    expect(await analysesOf(job.id)).toHaveLength(1);
  });
});

describe('configuration snapshots', () => {
  it('reuses one snapshot for the same configuration in any key order', async () => {
    const first = await createTestJob(database.db, { title: 'First' });
    const a = await analyzeJob(database.db, first.job.id, 'ack');
    const payloadA = buildFakeCallback(a.request, 'succeeded');
    expect(await deliverAnalyzeCallback(database.db, payloadA)).toBe(200);

    const second = await createTestJob(database.db, { title: 'Second' });
    const b = await analyzeJob(database.db, second.job.id, 'ack');
    const payloadB = buildFakeCallback(b.request, 'succeeded') as {
      versions: Record<string, unknown>;
    };
    payloadB.versions = reversed({
      ...payloadB.versions,
      scoring_weights: reversed(payloadB.versions.scoring_weights as Record<string, unknown>)
    });
    expect(await deliverAnalyzeCallback(database.db, payloadB)).toBe(200);

    expect(await database.db.select().from(configSnapshots)).toHaveLength(1);
    const [analysisA] = await analysesOf(first.job.id);
    const [analysisB] = await analysesOf(second.job.id);
    expect(analysisA.configSnapshotId).toBe(analysisB.configSnapshotId);
  });

  it('creates a new snapshot when the configuration changes', async () => {
    const { job } = await createTestJob(database.db);
    const a = await analyzeJob(database.db, job.id, 'success');
    await a.fake.flush();
    const b = await analyzeJob(database.db, job.id, 'ack');
    const changed = buildFakeCallback(b.request, 'succeeded') as {
      versions: { scoring: string };
    };
    changed.versions.scoring = 'score-v2';
    expect(await deliverAnalyzeCallback(database.db, changed)).toBe(200);

    const snapshots = await database.db.select().from(configSnapshots);
    expect(snapshots.map((snapshot) => snapshot.scoringVersion).toSorted()).toEqual([
      'score-v1',
      'score-v2'
    ]);
  });
});

describe('history and overrides', () => {
  it('keeps every analysis and points the job at the latest', async () => {
    const { job } = await createTestJob(database.db);
    const first = await analyzeJob(database.db, job.id, 'success');
    await first.fake.flush();
    await addListingSnapshot(database.db, job.id, { text: `${FIXTURE_LISTING} Updated.` });
    const second = await analyzeJob(database.db, job.id, 'success_hard_filtered');
    await second.fake.flush();

    const analyses = await analysesOf(job.id);
    expect(analyses).toHaveLength(2);
    const latest = analyses.find((row) => row.workflowRunId === second.run.id);
    expect((await jobRow(job.id)).currentAnalysisId).toBe(latest?.id);

    const detail = await getJobDetail(database.db, job.id);
    expect(detail?.analysis_history.map((item) => item.is_current)).toEqual([true, false]);
    expect(detail?.analysis?.for_current_listing).toBe(true);
    expect(detail?.listing?.snapshot_count).toBe(2);
  });

  it('stores owner values on the job without modifying the analysis', async () => {
    const { job } = await createTestJob(database.db);
    const { fake } = await analyzeJob(database.db, job.id, 'success');
    await fake.flush();
    const [before] = await analysesOf(job.id);

    await expectDomainError(
      overrideAnalysis(database.db, job.id, {
        manualScore: null,
        manualDisposition: 'PRIORITY',
        reason: null
      }),
      'INVALID_INPUT'
    );
    await overrideAnalysis(database.db, job.id, {
      manualScore: 9,
      manualDisposition: 'PRIORITY',
      reason: 'Repeat client I know well'
    });

    const [after] = await analysesOf(job.id);
    expect(after).toEqual(before);
    expect(await jobRow(job.id)).toMatchObject({
      manualScore: 9,
      manualDisposition: 'PRIORITY',
      overrideReason: 'Repeat client I know well'
    });
    const detail = await getJobDetail(database.db, job.id);
    expect(detail).toMatchObject({
      final_score: 9,
      final_disposition: 'PRIORITY',
      analysis: { system_score: 7.8, system_disposition: 'REVIEW' }
    });
    const override = await database.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.type, 'ANALYSIS_OVERRIDE'));
    expect(override[0]).toMatchObject({
      actor: 'owner',
      payload: { manual_score: 9, manual_disposition: 'PRIORITY', analysis_id: before.id }
    });

    // Matching the system recommendation needs no reason; clearing removes owner values.
    await overrideAnalysis(database.db, job.id, {
      manualScore: null,
      manualDisposition: 'REVIEW',
      reason: null
    });
    await overrideAnalysis(database.db, job.id, {
      manualScore: null,
      manualDisposition: null,
      reason: null
    });
    expect(await jobRow(job.id)).toMatchObject({
      manualScore: null,
      manualDisposition: null,
      overrideReason: null
    });
  });

  it('refuses an override without an analysis', async () => {
    const { job } = await createTestJob(database.db);
    await expectDomainError(
      overrideAnalysis(database.db, job.id, {
        manualScore: 5,
        manualDisposition: null,
        reason: null
      }),
      'NO_ANALYSIS'
    );
  });
});
