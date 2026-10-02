import 'server-only';

import { desc, eq } from 'drizzle-orm';

import type { Database, DbExecutor, Transaction } from '@/server/db/client';
import {
  jobAnalyses,
  jobListings,
  jobs,
  type JOB_STAGES,
  type JobListingRow,
  type JobRow
} from '@/server/db/schema';
import { pgErrorCode } from '@/server/runs/repository';
import { uuidv7 } from '@/server/runs/ids';

import { JobDomainError } from './errors';
import { appendJobEvent } from './events';
import { hashListingText, MAX_LISTING_CHARS, parseUpworkRef } from './listing-text';

type JobStage = (typeof JOB_STAGES)[number];

/** Stages from which a job can be (re-)analyzed or declined in this slice. */
export const ANALYZABLE_STAGES: readonly JobStage[] = ['discovered', 'reviewing'];
export const DECLINABLE_STAGES: readonly JobStage[] = ['discovered', 'reviewing'];

export interface CreateManualJobInput {
  title: string;
  url: string | null;
  listingText: string;
  now?: Date;
}

export interface CreatedJob {
  job: JobRow;
  listing: JobListingRow;
}

function assertListingText(text: string): void {
  if (text.trim().length === 0) {
    throw new JobDomainError('INVALID_INPUT', 'Listing text must not be blank.');
  }
  if (text.length > MAX_LISTING_CHARS) {
    throw new JobDomainError('INVALID_INPUT', 'Listing text is too long.');
  }
}

/**
 * Creates a manually pasted job with its first listing snapshot. A pasted listing is ready
 * for review, so the job starts in `reviewing` (architecture flow 3.2). No model call.
 */
export async function createManualJob(
  db: Database,
  input: CreateManualJobInput
): Promise<CreatedJob> {
  const now = input.now ?? new Date();
  const title = input.title.trim();
  if (title.length === 0 || title.length > 300) {
    throw new JobDomainError('INVALID_INPUT', 'Title must be between 1 and 300 characters.');
  }
  assertListingText(input.listingText);
  const upworkRef = parseUpworkRef(input.url);

  try {
    return await db.transaction(async (tx) => {
      const [job] = await tx
        .insert(jobs)
        .values({
          id: uuidv7(now),
          upworkRef,
          title,
          url: input.url,
          origin: 'manual_paste',
          stage: 'reviewing',
          createdAt: now,
          updatedAt: now
        })
        .returning();
      await appendJobEvent(tx, {
        jobId: job.id,
        type: 'JOB_CREATED',
        actor: 'owner',
        occurredAt: now,
        toStage: 'reviewing',
        payload: { origin: 'manual_paste' }
      });
      const listing = await insertListing(tx, job.id, input.listingText, input.url, now);
      return { job, listing };
    });
  } catch (error) {
    if (upworkRef && pgErrorCode(error) === '23505') {
      const [existing] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.upworkRef, upworkRef));
      if (existing) {
        throw new JobDomainError('JOB_EXISTS', 'A job with this Upwork URL already exists.', {
          jobId: existing.id
        });
      }
    }
    throw error;
  }
}

async function insertListing(
  tx: Transaction,
  jobId: string,
  text: string,
  sourceUrl: string | null,
  now: Date
): Promise<JobListingRow> {
  const [listing] = await tx
    .insert(jobListings)
    .values({
      id: uuidv7(now),
      jobId,
      rawText: text,
      textHash: hashListingText(text),
      sourceUrl,
      charCount: text.length,
      createdAt: now
    })
    .returning();
  await appendJobEvent(tx, {
    jobId,
    type: 'LISTING_ADDED',
    actor: 'owner',
    occurredAt: now,
    payload: { listing_id: listing.id, char_count: listing.charCount }
  });
  return listing;
}

export async function getJobRow(db: DbExecutor, jobId: string): Promise<JobRow | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  return job ?? null;
}

async function lockJob(tx: Transaction, jobId: string): Promise<JobRow> {
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for('update');
  if (!job) throw new JobDomainError('NOT_FOUND', 'Job not found.');
  return job;
}

export async function getCurrentListing(
  db: DbExecutor,
  jobId: string
): Promise<JobListingRow | null> {
  const [listing] = await db
    .select()
    .from(jobListings)
    .where(eq(jobListings.jobId, jobId))
    .orderBy(desc(jobListings.createdAt), desc(jobListings.id))
    .limit(1);
  return listing ?? null;
}

/**
 * Adds an immutable snapshot. Text identical to the current snapshot after normalization
 * creates nothing; any other change creates a new snapshot that becomes current.
 */
export async function addListingSnapshot(
  db: Database,
  jobId: string,
  input: { text: string; sourceUrl?: string | null; now?: Date }
): Promise<{ listing: JobListingRow; created: boolean }> {
  assertListingText(input.text);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    const current = await getCurrentListing(tx, jobId);
    if (current && current.textHash === hashListingText(input.text)) {
      return { listing: current, created: false };
    }
    const listing = await insertListing(tx, jobId, input.text, input.sourceUrl ?? job.url, now);
    await tx.update(jobs).set({ updatedAt: now }).where(eq(jobs.id, jobId));
    return { listing, created: true };
  });
}

/** Owner decision not to pursue the job. Requires a reason; the job is never deleted. */
export async function declineJob(
  db: Database,
  jobId: string,
  input: { reason: string; now?: Date }
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new JobDomainError('INVALID_INPUT', 'A reason is required to decline a job.');
  }
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!DECLINABLE_STAGES.includes(job.stage)) {
      throw new JobDomainError(
        'INVALID_STAGE',
        `A job in stage "${job.stage}" cannot be declined.`
      );
    }
    await tx
      .update(jobs)
      .set({ stage: 'declined', closeReason: reason, updatedAt: now })
      .where(eq(jobs.id, jobId));
    await appendJobEvent(tx, {
      jobId,
      type: 'DECLINED',
      actor: 'owner',
      occurredAt: now,
      fromStage: job.stage,
      toStage: 'declined',
      payload: { reason }
    });
  });
}

export interface OverrideInput {
  manualScore: number | null;
  manualDisposition: 'PRIORITY' | 'REVIEW' | 'LOW' | null;
  reason: string | null;
  now?: Date;
}

/**
 * Owner override of the current analysis. The analysis row is never modified: owner values
 * live on the job and every change is recorded as an ANALYSIS_OVERRIDE event.
 */
export async function overrideAnalysis(
  db: Database,
  jobId: string,
  input: OverrideInput
): Promise<void> {
  const now = input.now ?? new Date();
  const reason = input.reason?.trim() || null;
  if (input.manualScore !== null && (input.manualScore < 1 || input.manualScore > 10)) {
    throw new JobDomainError('INVALID_INPUT', 'Manual score must be between 1 and 10.');
  }
  await db.transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!job.currentAnalysisId) {
      throw new JobDomainError('NO_ANALYSIS', 'The job has no analysis to override.');
    }
    const [analysis] = await tx
      .select({ systemDisposition: jobAnalyses.systemDisposition })
      .from(jobAnalyses)
      .where(eq(jobAnalyses.id, job.currentAnalysisId));
    const changesRecommendation =
      input.manualDisposition !== null && input.manualDisposition !== analysis?.systemDisposition;
    if (changesRecommendation && !reason) {
      throw new JobDomainError(
        'INVALID_INPUT',
        'A reason is required when changing the recommendation.'
      );
    }
    const cleared = input.manualScore === null && input.manualDisposition === null;
    await tx
      .update(jobs)
      .set({
        manualScore: input.manualScore,
        manualDisposition: input.manualDisposition,
        overrideReason: cleared ? null : reason,
        updatedAt: now
      })
      .where(eq(jobs.id, jobId));
    await appendJobEvent(tx, {
      jobId,
      type: 'ANALYSIS_OVERRIDE',
      actor: 'owner',
      occurredAt: now,
      payload: {
        analysis_id: job.currentAnalysisId,
        manual_score: input.manualScore,
        manual_disposition: input.manualDisposition,
        reason: cleared ? null : reason,
        previous: { manual_score: job.manualScore, manual_disposition: job.manualDisposition }
      }
    });
  });
}
