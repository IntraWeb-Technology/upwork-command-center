import 'server-only';

import { eq } from 'drizzle-orm';

import type { AnalyzeModels, AnalyzeVersions } from '@/contracts';
import type { DbExecutor } from '@/server/db/client';
import { configSnapshots } from '@/server/db/schema';
import { canonicalHash } from '@/server/lib/canonical-json';
import { uuidv7 } from '@/server/runs/ids';

export interface ConfigSnapshotContent {
  workflow_version: string;
  scoring_version: string;
  extraction_prompt_version: string;
  analysis_prompt_version: string;
  profile_hash: string;
  scoring_weights: AnalyzeVersions['scoring_weights'];
  score_thresholds: AnalyzeVersions['score_thresholds'];
  hard_filter_rules: AnalyzeVersions['hard_filter_rules'];
  models: {
    extraction: { model: string; provider: string | null };
    analysis: { model: string; provider: string | null } | null;
  };
}

/**
 * The configuration a callback reports as executed. Models are the ones that actually ran
 * (an analysis model is absent when the hard filter stopped the run); per-run fallback
 * details are stored on the analysis instead so they do not fragment snapshots.
 */
export function configSnapshotContent(
  versions: AnalyzeVersions,
  models: AnalyzeModels
): ConfigSnapshotContent {
  return {
    workflow_version: versions.workflow,
    scoring_version: versions.scoring,
    extraction_prompt_version: versions.extraction_prompt,
    analysis_prompt_version: versions.analysis_prompt,
    profile_hash: versions.profile_hash,
    scoring_weights: versions.scoring_weights,
    score_thresholds: versions.score_thresholds,
    hard_filter_rules: versions.hard_filter_rules,
    models: {
      extraction: { model: models.extraction.model, provider: models.extraction.provider },
      analysis: models.analysis
        ? { model: models.analysis.model, provider: models.analysis.provider }
        : null
    }
  };
}

/** Content-addressed upsert: identical configuration (in any key order) reuses one row. */
export async function upsertConfigSnapshot(
  db: DbExecutor,
  content: ConfigSnapshotContent,
  now: Date
): Promise<string> {
  const contentHash = canonicalHash(content);
  const [inserted] = await db
    .insert(configSnapshots)
    .values({
      id: uuidv7(now),
      contentHash,
      workflowVersion: content.workflow_version,
      scoringVersion: content.scoring_version,
      extractionPromptVersion: content.extraction_prompt_version,
      analysisPromptVersion: content.analysis_prompt_version,
      profileHash: content.profile_hash,
      scoringWeights: content.scoring_weights,
      scoreThresholds: content.score_thresholds,
      hardFilterRules: content.hard_filter_rules,
      models: content.models,
      firstSeenAt: now
    })
    .onConflictDoNothing({ target: configSnapshots.contentHash })
    .returning({ id: configSnapshots.id });
  if (inserted) return inserted.id;

  const [existing] = await db
    .select({ id: configSnapshots.id })
    .from(configSnapshots)
    .where(eq(configSnapshots.contentHash, contentHash));
  if (!existing) throw new Error('config snapshot vanished after a conflicting insert');
  return existing.id;
}
