import { describe, expect, it } from 'vitest';

import { analyzeCallbackSchema, type AnalyzeCallback } from '@/contracts';
import { DISPOSITIONS, SCORE_DIMENSION_NAMES } from '@/server/db/schema';
import { SCORE_DIMENSIONS, SYSTEM_DISPOSITIONS } from '@/contracts';
import { loadFixture } from '@/test/contract-fixtures';

import { buildScoreRows } from './materialize';

type Succeeded = Extract<AnalyzeCallback, { status: 'succeeded' }>;

function succeeded(): Succeeded {
  return analyzeCallbackSchema.parse(
    loadFixture('analyze', 'valid', 'callback.succeeded.json')
  ) as Succeeded;
}

describe('analysis score rows', () => {
  it('builds exactly one row per contract dimension with its weight and evidence', () => {
    const rows = buildScoreRows('analysis-1', succeeded());
    expect(rows.map((row) => row.dimension)).toEqual([...SCORE_DIMENSIONS]);
    expect(rows[0]).toEqual({
      analysisId: 'analysis-1',
      dimension: 'technical_fit',
      score: 9,
      weight: 0.25,
      evidence: 'Next.js and PostgreSQL are core skills.'
    });
  });

  it('refuses an incomplete dimension set before anything is persisted', () => {
    const callback = succeeded();
    const scores = callback.result.analysis?.scores as Record<string, number>;
    delete scores.strategic_fit;
    expect(() => buildScoreRows('analysis-1', callback)).toThrow('strategic_fit');
  });

  it('returns no rows for a hard-filter rejection', () => {
    const callback = analyzeCallbackSchema.parse(
      loadFixture('analyze', 'valid', 'callback.succeeded-hard-filtered.json')
    ) as Succeeded;
    expect(buildScoreRows('analysis-1', callback)).toEqual([]);
  });

  it('keeps database vocabularies in sync with the contract', () => {
    expect([...SCORE_DIMENSION_NAMES]).toEqual([...SCORE_DIMENSIONS]);
    expect([...DISPOSITIONS]).toEqual([...SYSTEM_DISPOSITIONS]);
  });
});
