import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { jobEvents, jobListings, jobs } from '@/server/db/schema';
import { setupTestDatabase } from '@/test/integration/database';
import { analyzeJob, createTestJob, FIXTURE_LISTING } from '@/test/integration/jobs';

import { JobDomainError } from './errors';
import { getJobDetail, listJobs } from './read-models';
import { addListingSnapshot, declineJob, getCurrentListing } from './repository';

const database = setupTestDatabase();

async function eventsOf(jobId: string) {
  return database.db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(jobEvents.occurredAt, jobEvents.recordedAt);
}

async function expectDomainError(promise: Promise<unknown>, code: JobDomainError['code']) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof JobDomainError && error.code === code
  );
}

describe('manual job creation', () => {
  it('creates a reviewing job with its first snapshot and creation events', async () => {
    const { job, listing } = await createTestJob(database.db, {
      url: 'https://www.upwork.com/jobs/~01abcdef0123456789'
    });

    expect(job).toMatchObject({
      origin: 'manual_paste',
      stage: 'reviewing',
      upworkRef: '~01abcdef0123456789',
      currentAnalysisId: null
    });
    expect(listing).toMatchObject({
      jobId: job.id,
      rawText: FIXTURE_LISTING,
      charCount: FIXTURE_LISTING.length
    });
    expect(listing.textHash).toMatch(/^[0-9a-f]{64}$/);

    const events = await eventsOf(job.id);
    expect(events.map((event) => event.type)).toEqual(['JOB_CREATED', 'LISTING_ADDED']);
    expect(events[0]).toMatchObject({ actor: 'owner', toStage: 'reviewing' });
    expect(JSON.stringify(events)).not.toContain('SYNTHETIC FIXTURE LISTING');
  });

  it('rejects a second job for the same Upwork reference', async () => {
    const url = 'https://www.upwork.com/jobs/~01abcdef0123456789';
    const { job } = await createTestJob(database.db, { url });
    await expect(createTestJob(database.db, { url: `${url}?source=alert` })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof JobDomainError &&
        error.code === 'JOB_EXISTS' &&
        error.details.jobId === job.id
    );
  });

  it('validates title and listing text', async () => {
    await expectDomainError(createTestJob(database.db, { title: '   ' }), 'INVALID_INPUT');
    await expectDomainError(createTestJob(database.db, { listingText: ' \n ' }), 'INVALID_INPUT');
  });
});

describe('listing snapshots', () => {
  it('does not duplicate identical normalized text', async () => {
    const { job, listing } = await createTestJob(database.db);
    const result = await addListingSnapshot(database.db, job.id, {
      text: `  ${FIXTURE_LISTING.replace(/ /, ' ')}  \r\n`
    });
    expect(result).toMatchObject({ created: false, listing: { id: listing.id } });
    const rows = await database.db.select().from(jobListings).where(eq(jobListings.jobId, job.id));
    expect(rows).toHaveLength(1);
  });

  it('stores changed text as a new current snapshot and keeps the old one', async () => {
    const { job, listing } = await createTestJob(database.db);
    const changed = `${FIXTURE_LISTING} Budget increased to 6000 USD.`;
    const result = await addListingSnapshot(database.db, job.id, { text: changed });
    expect(result.created).toBe(true);
    expect((await getCurrentListing(database.db, job.id))?.id).toBe(result.listing.id);
    const rows = await database.db.select().from(jobListings).where(eq(jobListings.jobId, job.id));
    expect(rows.map((row) => row.id).toSorted()).toEqual(
      [listing.id, result.listing.id].toSorted()
    );
    expect((await eventsOf(job.id)).filter((e) => e.type === 'LISTING_ADDED')).toHaveLength(2);
  });

  it('rejects updates and deletes of history rows at the database level', async () => {
    const { listing } = await createTestJob(database.db);
    await expect(
      database.db
        .update(jobListings)
        .set({ rawText: 'tampered' })
        .where(eq(jobListings.id, listing.id))
    ).rejects.toThrow();
    await expect(
      database.db.delete(jobListings).where(eq(jobListings.id, listing.id))
    ).rejects.toThrow();
    await expect(
      database.db.execute(sql`update job_events set actor = 'system'`)
    ).rejects.toThrow();
  });
});

describe('decline', () => {
  it('moves the job to declined with a reason and an event, without deleting it', async () => {
    const { job } = await createTestJob(database.db);
    await declineJob(database.db, job.id, { reason: 'Budget too low' });

    const [row] = await database.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row).toMatchObject({ stage: 'declined', closeReason: 'Budget too low' });
    const declined = (await eventsOf(job.id)).find((event) => event.type === 'DECLINED');
    expect(declined).toMatchObject({
      actor: 'owner',
      fromStage: 'reviewing',
      toStage: 'declined',
      payload: { reason: 'Budget too low' }
    });
  });

  it('requires a reason, refuses a second decline, and blocks analysis afterwards', async () => {
    const { job } = await createTestJob(database.db);
    await expectDomainError(declineJob(database.db, job.id, { reason: '  ' }), 'INVALID_INPUT');
    await declineJob(database.db, job.id, { reason: 'Not a fit' });
    await expectDomainError(declineJob(database.db, job.id, { reason: 'Again' }), 'INVALID_STAGE');
    await expectDomainError(analyzeJob(database.db, job.id), 'INVALID_STAGE');
  });

  it('is atomic: a failed event insert leaves the stage unchanged', async () => {
    const { job } = await createTestJob(database.db);
    await expect(
      database.db.transaction(async (tx) => {
        await tx.update(jobs).set({ stage: 'declined' }).where(eq(jobs.id, job.id));
        await tx.execute(sql`insert into job_events (id) values (gen_random_uuid())`);
      })
    ).rejects.toThrow();
    const [row] = await database.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.stage).toBe('reviewing');
  });

  it('reports unknown jobs as NOT_FOUND', async () => {
    await expectDomainError(
      declineJob(database.db, '01920000-0000-7000-8000-000000000000', { reason: 'x' }),
      'NOT_FOUND'
    );
  });
});

describe('read models', () => {
  it('lists jobs with search, stage filter, sorting, and pagination', async () => {
    const a = await createTestJob(database.db, { title: 'Alpha dashboard' });
    await createTestJob(database.db, { title: 'Beta scraper' });
    await declineJob(database.db, a.job.id, { reason: 'No' });

    const all = await listJobs(database.db, {
      sort: JSON.stringify([{ id: 'title', desc: false }])
    });
    expect(all.total).toBe(2);
    expect(all.items.map((item) => item.title)).toEqual(['Alpha dashboard', 'Beta scraper']);

    expect((await listJobs(database.db, { search: 'beta' })).items).toHaveLength(1);
    expect((await listJobs(database.db, { stage: 'declined' })).items[0].title).toBe(
      'Alpha dashboard'
    );
    const paged = await listJobs(database.db, { page: 2, perPage: 1 });
    expect(paged).toMatchObject({ total: 2 });
    expect(paged.items).toHaveLength(1);
  });

  it('exposes no hashes, tokens, request payloads, or n8n references', async () => {
    const { job } = await createTestJob(database.db);
    const started = await analyzeJob(database.db, job.id);
    await started.fake.flush();
    const detail = await getJobDetail(database.db, job.id);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toMatch(/[0-9a-f]{64}/);
    expect(serialized).not.toContain('fake-');
    expect(serialized).not.toContain(started.request.callback.token);
    expect(serialized).not.toMatch(
      /"(request|result|callback\w*|text_hash|raw_result|execution_ref|n8n\w*|config\w*)":/
    );
  });
});
