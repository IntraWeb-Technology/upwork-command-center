import 'server-only';

import { eq } from 'drizzle-orm';

import { SCORE_DIMENSIONS, type AnalyzeCallback } from '@/contracts';
import type { Transaction } from '@/server/db/client';
import { analysisScores, jobAnalyses, jobs } from '@/server/db/schema';
import { appendJobEvent } from '@/server/jobs/events';
import type { MaterializeCallback } from '@/server/runs/callback';
import { uuidv7 } from '@/server/runs/ids';
import type { AnalyzeRequestSummary } from '@/server/runs/request-summary';
import type { WorkflowRun } from '@/server/runs/types';

import { configSnapshotContent, upsertConfigSnapshot } from './config-snapshot';

type AnalyzeSucceeded = Extract<AnalyzeCallback, { status: 'succeeded' }>;

/**
 * Builds the full score set. Throws (rolling back the callback) unless every contract
 * dimension is present, so a scored analysis can never be persisted partially.
 */
export function buildScoreRows(analysisId: string, callback: AnalyzeSucceeded) {
  const analysis = callback.result.analysis;
  if (!analysis) return [];
  const weights = callback.versions.scoring_weights;
  const rows = SCORE_DIMENSIONS.map((dimension) => {
    const score = analysis.scores[dimension];
    const weight = weights[dimension];
    if (typeof score !== 'number' || typeof weight !== 'number') {
      throw new Error(`analysis is missing the ${dimension} dimension`);
    }
    return {
      analysisId,
      dimension,
      score,
      weight,
      evidence: analysis.dimension_evidence[dimension] ?? null
    };
  });
  return rows;
}

/**
 * Persists a successful ujh.analyze.v1 callback inside the callback transaction, before the
 * run is marked succeeded. Any failure throws and rolls back the run transition too, so a
 * succeeded run always has its analysis. Failed callbacks and runs without a job only
 * update the run.
 */
export const materializeAnalysisResult: MaterializeCallback = async (tx, run, callback) => {
  if (callback.contract !== 'ujh.analyze.v1' || callback.status !== 'succeeded') return;
  if (!run.jobId) return;
  return persistAnalysis(tx, run, run.jobId, callback);
};

async function persistAnalysis(
  tx: Transaction,
  run: WorkflowRun,
  jobId: string,
  callback: AnalyzeSucceeded
): Promise<Record<string, unknown>> {
  const now = new Date();
  const listingId = (run.request as Partial<AnalyzeRequestSummary>).listing_id;
  if (!listingId) throw new Error('analyze run has no listing reference');

  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for('update');
  if (!job) throw new Error('analyze run references a missing job');

  const configSnapshotId = await upsertConfigSnapshot(
    tx,
    configSnapshotContent(callback.versions, callback.models),
    now
  );

  const { extraction, hard_filter: hardFilter, analysis } = callback.result;
  const analysisId = uuidv7(now);
  const scoreRows = buildScoreRows(analysisId, callback);

  await tx.insert(jobAnalyses).values({
    id: analysisId,
    jobId,
    listingId,
    workflowRunId: run.id,
    configSnapshotId,
    extractionStatus: extraction.status,
    extractionError: extraction.error,
    facts: extraction.facts,
    hardFilterPass: hardFilter.pass,
    hardFilterReasons: hardFilter.reasons,
    weightedScore: analysis?.weighted_score ?? null,
    redFlagPenalty: analysis?.red_flag_penalty ?? null,
    systemScore: analysis?.system_score ?? null,
    systemDisposition: analysis?.system_disposition ?? null,
    redFlags: analysis?.red_flags ?? null,
    positiveSignals: analysis?.positive_signals ?? null,
    clientProblem: analysis?.client_problem ?? null,
    whyCandidateMatches: analysis?.why_candidate_matches ?? null,
    missingInformation: analysis?.missing_information ?? null,
    recommendedPositioning: analysis?.recommended_positioning ?? null,
    clientSummary: analysis?.client_summary ?? null,
    analysisSummary: analysis?.analysis_summary ?? null,
    extractionModel: callback.models.extraction.model,
    extractionProvider: callback.models.extraction.provider,
    extractionFallbackUsed: callback.models.extraction.fallback_used,
    analysisModel: callback.models.analysis?.model ?? null,
    analysisProvider: callback.models.analysis?.provider ?? null,
    analysisFallbackUsed: callback.models.analysis?.fallback_used ?? null,
    completedAt: new Date(callback.completed_at),
    rawResult: callback.result,
    createdAt: now
  });
  if (scoreRows.length > 0) await tx.insert(analysisScores).values(scoreRows);

  // A rejected hard filter is recorded, never auto-dismissed: the owner decides.
  const toStage = job.stage === 'discovered' ? 'reviewing' : job.stage;
  await tx
    .update(jobs)
    .set({ currentAnalysisId: analysisId, stage: toStage, updatedAt: now })
    .where(eq(jobs.id, jobId));

  await appendJobEvent(tx, {
    jobId,
    type: 'ANALYZED',
    actor: 'n8n',
    occurredAt: new Date(callback.completed_at),
    fromStage: toStage === job.stage ? null : job.stage,
    toStage: toStage === job.stage ? null : toStage,
    workflowRunId: run.id,
    idempotencyKey: `run:${run.id}:ANALYZED`,
    payload: {
      analysis_id: analysisId,
      hard_filter_pass: hardFilter.pass,
      system_score: analysis?.system_score ?? null,
      system_disposition: analysis?.system_disposition ?? null
    }
  });

  return {
    completed_at: callback.completed_at,
    analysis_id: analysisId,
    config_snapshot_id: configSnapshotId
  };
}
