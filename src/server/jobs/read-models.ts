import 'server-only';

import { and, asc, count, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { ExtractionFacts } from '@/contracts';
import type {
  AnalysisHistoryItem,
  AnalysisView,
  Disposition,
  ExtractionFactsView,
  JobDetail,
  JobFilters,
  JobListItem,
  JobListResponse,
  TimelineEntry,
  WorkflowRunView
} from '@/features/jobs/api/types';
import type { DbExecutor } from '@/server/db/client';
import {
  analysisScores,
  jobAnalyses,
  jobEvents,
  jobListings,
  jobs,
  JOB_STAGES,
  SCORE_DIMENSION_NAMES,
  workflowRuns,
  type JobAnalysisRow,
  type JobEventRow,
  type WorkflowRunRow
} from '@/server/db/schema';
import { getEffectiveStatus } from '@/server/runs/effective-status';
import type { WorkflowRun } from '@/server/runs/types';

import { ANALYZABLE_STAGES, DECLINABLE_STAGES, getCurrentListing } from './repository';

const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null) => (date ? date.toISOString() : null);

/** Safe run read model: no request summary, result, token digest, or n8n reference. */
export function toRunView(
  run: WorkflowRun | Omit<WorkflowRunRow, 'callbackTokenHash'>,
  now: Date = new Date()
): WorkflowRunView {
  return {
    id: run.id,
    contract: run.contract as WorkflowRunView['contract'],
    stored_status: run.status,
    effective_status: getEffectiveStatus(run, now),
    requested_at: iso(run.requestedAt),
    started_at: isoOrNull(run.dispatchedAt),
    finished_at: isoOrNull(run.finishedAt),
    deadline_at: iso(run.deadlineAt),
    error:
      run.status === 'failed' && run.errorCode && run.errorMessage
        ? { code: run.errorCode, message: run.errorMessage, retryable: run.retryable ?? false }
        : null
  };
}

const runViewColumns = {
  id: workflowRuns.id,
  contract: workflowRuns.contract,
  jobId: workflowRuns.jobId,
  status: workflowRuns.status,
  request: workflowRuns.request,
  result: workflowRuns.result,
  errorCode: workflowRuns.errorCode,
  errorStage: workflowRuns.errorStage,
  errorMessage: workflowRuns.errorMessage,
  retryable: workflowRuns.retryable,
  n8nExecutionRef: workflowRuns.n8nExecutionRef,
  attempt: workflowRuns.attempt,
  retryOfRunId: workflowRuns.retryOfRunId,
  requestedAt: workflowRuns.requestedAt,
  dispatchedAt: workflowRuns.dispatchedAt,
  finishedAt: workflowRuns.finishedAt,
  deadlineAt: workflowRuns.deadlineAt
};

export async function getWorkflowRunView(
  db: DbExecutor,
  runId: string,
  now: Date = new Date()
): Promise<WorkflowRunView | null> {
  const [row] = await db
    .select(runViewColumns)
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId));
  return row ? toRunView(row, now) : null;
}

function finalValues(
  job: { manualScore: number | null; manualDisposition: Disposition | null },
  analysis: { systemScore: number | null; systemDisposition: Disposition | null } | null
) {
  return {
    final_score: job.manualScore ?? analysis?.systemScore ?? null,
    final_disposition: job.manualDisposition ?? analysis?.systemDisposition ?? null
  };
}

// List

const SORTABLE: Record<string, SQL | AnyPgColumn> = {
  title: sql`lower(${jobs.title})`,
  stage: jobs.stage,
  system_score: jobAnalyses.systemScore,
  final_score: sql`coalesce(${jobs.manualScore}, ${jobAnalyses.systemScore})`,
  created_at: jobs.createdAt,
  updated_at: jobs.updatedAt
};

function parseSort(sort: string | undefined): SQL[] {
  const fallback = [desc(jobs.updatedAt), desc(jobs.id)];
  if (!sort) return fallback;
  try {
    const parsed: unknown = JSON.parse(sort);
    if (!Array.isArray(parsed)) return fallback;
    const orders = parsed.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];
      const { id, desc: descending } = item as { id?: unknown; desc?: unknown };
      const column = typeof id === 'string' ? SORTABLE[id] : undefined;
      if (!column) return [];
      return [descending === true ? sql`${column} desc nulls last` : sql`${column} asc nulls last`];
    });
    return orders.length > 0 ? [...orders, desc(jobs.id)] : fallback;
  } catch {
    return fallback;
  }
}

export async function listJobs(
  db: DbExecutor,
  filters: JobFilters,
  now: Date = new Date()
): Promise<JobListResponse> {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(100, Math.max(1, filters.perPage ?? 10));
  const conditions: SQL[] = [];
  const search = filters.search?.trim();
  if (search) conditions.push(ilike(jobs.title, `%${search.replace(/[\\%_]/g, '\\$&')}%`));
  const stages = (filters.stage ?? '')
    .split(/[.,]/)
    .filter((stage): stage is (typeof JOB_STAGES)[number] =>
      (JOB_STAGES as readonly string[]).includes(stage)
    );
  if (stages.length > 0) conditions.push(inArray(jobs.stage, stages));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: jobs.id,
        title: jobs.title,
        stage: jobs.stage,
        manualScore: jobs.manualScore,
        manualDisposition: jobs.manualDisposition,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        systemScore: jobAnalyses.systemScore,
        systemDisposition: jobAnalyses.systemDisposition,
        hardFilterPass: jobAnalyses.hardFilterPass
      })
      .from(jobs)
      .leftJoin(jobAnalyses, eq(jobAnalyses.id, jobs.currentAnalysisId))
      .where(where)
      .orderBy(...parseSort(filters.sort))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(jobs).where(where)
  ]);

  const latestRuns = await latestAnalyzeRuns(
    db,
    rows.map((row) => row.id)
  );

  const items: JobListItem[] = rows.map((row) => {
    const run = latestRuns.get(row.id);
    return {
      id: row.id,
      title: row.title,
      stage: row.stage,
      system_score: row.systemScore,
      system_disposition: row.systemDisposition,
      hard_filter_pass: row.hardFilterPass,
      ...finalValues(row, row.hardFilterPass === null ? null : row),
      has_override: row.manualScore !== null || row.manualDisposition !== null,
      analysis_status: run ? getEffectiveStatus(run, now) : null,
      created_at: iso(row.createdAt),
      updated_at: iso(row.updatedAt)
    };
  });
  return { items, total };
}

async function latestAnalyzeRuns(db: DbExecutor, jobIds: string[]) {
  const map = new Map<string, Pick<WorkflowRunRow, 'status' | 'deadlineAt'>>();
  if (jobIds.length === 0) return map;
  const rows = await db
    .selectDistinctOn([workflowRuns.jobId], {
      jobId: workflowRuns.jobId,
      status: workflowRuns.status,
      deadlineAt: workflowRuns.deadlineAt
    })
    .from(workflowRuns)
    .where(and(inArray(workflowRuns.jobId, jobIds), eq(workflowRuns.contract, 'ujh.analyze.v1')))
    .orderBy(workflowRuns.jobId, desc(workflowRuns.requestedAt));
  for (const row of rows) if (row.jobId) map.set(row.jobId, row);
  return map;
}

// Detail

function toFactsView(facts: ExtractionFacts | null): ExtractionFactsView | null {
  if (!facts) return null;
  return {
    title: facts.title,
    posted_at: facts.posted_at,
    budget_type: facts.budget_type,
    budget_min: facts.budget_min,
    budget_max: facts.budget_max,
    hourly_min: facts.hourly_min,
    hourly_max: facts.hourly_max,
    connect_cost: facts.connect_cost,
    payment_verified: facts.payment_verified,
    client_location: facts.client_location,
    client_total_spend: facts.client_total_spend,
    client_hires: facts.client_hires,
    client_rating: facts.client_rating,
    proposal_count: facts.proposal_count,
    skills: facts.skills,
    job_category: facts.job_category,
    excludes_us_freelancers: facts.excludes_us_freelancers,
    is_likely_scam: facts.is_likely_scam,
    scam_signals: facts.scam_signals,
    listing_is_incomplete: facts.listing_is_incomplete,
    summary: facts.summary
  };
}

async function toAnalysisView(
  db: DbExecutor,
  analysis: JobAnalysisRow,
  currentListingId: string | null
): Promise<AnalysisView> {
  const scores = await db
    .select()
    .from(analysisScores)
    .where(eq(analysisScores.analysisId, analysis.id));
  const order = new Map(SCORE_DIMENSION_NAMES.map((dimension, index) => [dimension, index]));
  return {
    id: analysis.id,
    created_at: iso(analysis.createdAt),
    completed_at: iso(analysis.completedAt),
    listing_id: analysis.listingId,
    for_current_listing: analysis.listingId === currentListingId,
    extraction: {
      status: analysis.extractionStatus,
      error: analysis.extractionError,
      facts: toFactsView(analysis.facts as ExtractionFacts | null)
    },
    hard_filter: { pass: analysis.hardFilterPass, reasons: analysis.hardFilterReasons },
    system_score: analysis.systemScore,
    system_disposition: analysis.systemDisposition,
    weighted_score: analysis.weightedScore,
    red_flag_penalty: analysis.redFlagPenalty,
    scores: scores
      .toSorted((a, b) => (order.get(a.dimension) ?? 0) - (order.get(b.dimension) ?? 0))
      .map((score) => ({
        dimension: score.dimension,
        score: score.score,
        weight: score.weight,
        evidence: score.evidence
      })),
    red_flags: analysis.redFlags ?? [],
    positive_signals: analysis.positiveSignals ?? [],
    client_problem: analysis.clientProblem,
    why_candidate_matches: analysis.whyCandidateMatches ?? [],
    missing_information: analysis.missingInformation ?? [],
    recommended_positioning: analysis.recommendedPositioning,
    client_summary: analysis.clientSummary,
    analysis_summary: analysis.analysisSummary
  };
}

function describeEvent(event: JobEventRow): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'JOB_CREATED':
      return 'Job created from a pasted listing';
    case 'LISTING_ADDED':
      return typeof payload.char_count === 'number'
        ? `Listing snapshot saved (${payload.char_count.toLocaleString('en-US')} characters)`
        : 'Listing snapshot saved';
    case 'ANALYSIS_STARTED':
      return 'Analysis requested';
    case 'ANALYZED':
      if (payload.hard_filter_pass === false) return 'Hard filter failed';
      return typeof payload.system_score === 'number'
        ? `System score ${payload.system_score} (${String(payload.system_disposition)})`
        : 'Analysis completed';
    case 'DECLINED':
      return typeof payload.reason === 'string' ? `Reason: ${payload.reason}` : null;
    case 'ANALYSIS_OVERRIDE': {
      const parts: string[] = [];
      if (payload.manual_score === null && payload.manual_disposition === null) {
        return 'Owner override cleared';
      }
      if (typeof payload.manual_score === 'number') parts.push(`score ${payload.manual_score}`);
      if (typeof payload.manual_disposition === 'string') parts.push(payload.manual_disposition);
      const reason = typeof payload.reason === 'string' ? `. Reason: ${payload.reason}` : '';
      return `Owner set ${parts.join(', ')}${reason}`;
    }
  }
}

export async function getJobDetail(
  db: DbExecutor,
  jobId: string,
  now: Date = new Date()
): Promise<JobDetail | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return null;

  const [listing, [{ snapshots }], history, [latestRun], events] = await Promise.all([
    getCurrentListing(db, jobId),
    db.select({ snapshots: count() }).from(jobListings).where(eq(jobListings.jobId, jobId)),
    db
      .select()
      .from(jobAnalyses)
      .where(eq(jobAnalyses.jobId, jobId))
      .orderBy(desc(jobAnalyses.createdAt), desc(jobAnalyses.id)),
    db
      .select(runViewColumns)
      .from(workflowRuns)
      .where(and(eq(workflowRuns.jobId, jobId), eq(workflowRuns.contract, 'ujh.analyze.v1')))
      .orderBy(desc(workflowRuns.requestedAt))
      .limit(1),
    db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, jobId))
      .orderBy(asc(jobEvents.occurredAt), asc(jobEvents.recordedAt))
      .limit(500)
  ]);

  const current = history.find((row) => row.id === job.currentAnalysisId) ?? null;
  const analysis = current ? await toAnalysisView(db, current, listing?.id ?? null) : null;
  const runView = latestRun ? toRunView(latestRun, now) : null;
  const runActive =
    runView !== null &&
    (runView.effective_status === 'queued' || runView.effective_status === 'running');

  const analysisHistory: AnalysisHistoryItem[] = history.map((row) => ({
    id: row.id,
    created_at: iso(row.createdAt),
    system_score: row.systemScore,
    system_disposition: row.systemDisposition,
    hard_filter_pass: row.hardFilterPass,
    is_current: row.id === job.currentAnalysisId
  }));

  const timeline: TimelineEntry[] = events.map((event) => ({
    id: event.id,
    type: event.type,
    actor: event.actor,
    from_stage: event.fromStage,
    to_stage: event.toStage,
    occurred_at: iso(event.occurredAt),
    detail: describeEvent(event)
  }));

  return {
    id: job.id,
    title: job.title,
    url: job.url,
    upwork_ref: job.upworkRef,
    origin: job.origin,
    stage: job.stage,
    close_reason: job.closeReason,
    created_at: iso(job.createdAt),
    updated_at: iso(job.updatedAt),
    listing: listing
      ? {
          id: listing.id,
          text: listing.rawText,
          char_count: listing.charCount,
          source_url: listing.sourceUrl,
          created_at: iso(listing.createdAt),
          snapshot_count: snapshots
        }
      : null,
    analysis,
    analysis_history: analysisHistory,
    override: {
      manual_score: job.manualScore,
      manual_disposition: job.manualDisposition,
      reason: job.overrideReason
    },
    ...finalValues(job, current),
    latest_run: runView,
    can_analyze: ANALYZABLE_STAGES.includes(job.stage) && listing !== null && !runActive,
    can_decline: DECLINABLE_STAGES.includes(job.stage),
    timeline
  };
}
