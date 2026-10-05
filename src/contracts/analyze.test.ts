import { describe, expect, it } from 'vitest';

import { cloneFixture, loadFixture, type MutableJson as Json } from '@/test/contract-fixtures';

import {
  analyzeCallbackSchema,
  analyzeRequestSchema,
  hardFilterReasonCode,
  hardFilterReasonSchema
} from './analyze';

const request = loadFixture('analyze', 'valid', 'request.paste.json') as Json;
const succeeded = loadFixture('analyze', 'valid', 'callback.succeeded.json') as Json;
const hardFiltered = loadFixture(
  'analyze',
  'valid',
  'callback.succeeded-hard-filtered.json'
) as Json;
const failed = loadFixture('analyze', 'valid', 'callback.failed.json') as Json;

function variant(base: Json, mutate: (value: Json) => void): Json {
  const copy = cloneFixture(base);
  mutate(copy);
  return copy;
}

describe('ujh.analyze.v1 request', () => {
  it('accepts a complete request', () => {
    expect(analyzeRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects a different contract version', () => {
    const wrong = variant(request, (r) => (r.contract = 'ujh.analyze.v2'));
    expect(analyzeRequestSchema.safeParse(wrong).success).toBe(false);
  });

  it('accepts a short listing, which the hard filter handles', () => {
    const short = variant(request, (r) => (r.input.listing_text = 'Fix my site'));
    expect(analyzeRequestSchema.safeParse(short).success).toBe(true);
  });

  it('accepts a job without an Upwork reference or source URL', () => {
    const anonymous = variant(request, (r) => {
      r.job.upwork_ref = null;
      r.job.source_url = null;
    });
    expect(analyzeRequestSchema.safeParse(anonymous).success).toBe(true);
  });

  it.each([
    ['Slack fields', (r: Json) => (r.slack_channel = 'C000')],
    ['Data Table ids', (r: Json) => (r.job.data_table_id = 'tbl')],
    ['a non-URL callback', (r: Json) => (r.callback.url = 'not a url')],
    ['a short callback token', (r: Json) => (r.callback.token = 'short')],
    ['a malformed Upwork reference', (r: Json) => (r.job.upwork_ref = '01abc')]
  ])('rejects %s', (_name, mutate) => {
    expect(analyzeRequestSchema.safeParse(variant(request, mutate)).success).toBe(false);
  });
});

describe('ujh.analyze.v1 success callback', () => {
  it('accepts a full analysis', () => {
    expect(analyzeCallbackSchema.safeParse(succeeded).success).toBe(true);
  });

  it('accepts a hard-filter rejection with null analysis', () => {
    const parsed = analyzeCallbackSchema.parse(hardFiltered);
    expect(parsed.status === 'succeeded' && parsed.result.analysis).toBeNull();
  });

  it('accepts INCOMPLETE_LISTING as a hard-filter reason on a successful run', () => {
    const incomplete = variant(
      hardFiltered,
      (c) => (c.result.hard_filter.reasons = ['INCOMPLETE_LISTING'])
    );
    expect(analyzeCallbackSchema.safeParse(incomplete).success).toBe(true);
  });

  it('accepts an extraction failure as a successful run', () => {
    const extractionFailed = variant(succeeded, (c) => {
      c.result.extraction = { status: 'failed', error: 'synthetic extraction error', facts: null };
    });
    expect(analyzeCallbackSchema.safeParse(extractionFailed).success).toBe(true);
  });

  it.each([
    [
      'analysis present when the hard filter failed',
      (c: Json) => (c.result.analysis = succeeded.result.analysis)
    ],
    [
      'analysis missing when the hard filter passed',
      (c: Json) => {
        c.result.hard_filter = { pass: true, reasons: [] };
      }
    ],
    ['pass true with reasons', (c: Json) => (c.result.hard_filter.pass = true)]
  ])('rejects %s', (_name, mutate) => {
    expect(analyzeCallbackSchema.safeParse(variant(hardFiltered, mutate)).success).toBe(false);
  });

  it.each([
    ['an unknown score dimension', (c: Json) => (c.result.analysis.scores.budget_fit = 7)],
    [
      'a renamed score dimension',
      (c: Json) => {
        delete c.result.analysis.scores.budget_score;
        c.result.analysis.scores.budget = 7;
      }
    ],
    ['a score above 10', (c: Json) => (c.result.analysis.scores.technical_fit = 11)],
    [
      'an unknown evidence dimension',
      (c: Json) => (c.result.analysis.dimension_evidence.vibes = 'x')
    ],
    ['a red flag penalty above 3', (c: Json) => (c.result.analysis.red_flag_penalty = 4)],
    [
      'an unknown job category',
      (c: Json) => (c.result.extraction.facts.job_category = 'WORDPRESS')
    ],
    [
      'REJECT_HARD as a system disposition',
      (c: Json) => (c.result.analysis.system_disposition = 'REJECT_HARD')
    ],
    ['proposal strategy on analysis', (c: Json) => (c.result.analysis.proposal_strategy = 'x')],
    ['strengths on analysis', (c: Json) => (c.result.analysis.strengths = ['x'])],
    ['reasoning on analysis', (c: Json) => (c.result.analysis.reasoning = 'x')],
    [
      'an unknown hard-filter reason',
      (c: Json) => {
        c.result.hard_filter.reasons = ['TOO_CHEAP'];
        c.result.hard_filter.pass = false;
        c.result.analysis = null;
        c.models.analysis = null;
      }
    ]
  ])('rejects %s', (_name, mutate) => {
    expect(analyzeCallbackSchema.safeParse(variant(succeeded, mutate)).success).toBe(false);
  });
});

describe('ujh.analyze.v1 execution metadata', () => {
  it.each([
    ['a missing workflow version', (c: Json) => delete c.versions.workflow],
    ['missing scoring weights', (c: Json) => delete c.versions.scoring_weights],
    ['a weight for an unknown dimension', (c: Json) => (c.versions.scoring_weights.vibes = 0.1)],
    ['a review threshold above priority', (c: Json) => (c.versions.score_thresholds.review = 9)],
    ['a non-hex profile hash', (c: Json) => (c.versions.profile_hash = 'not-a-hash')],
    ['missing hard filter rules', (c: Json) => delete c.versions.hard_filter_rules],
    ['a missing extraction model', (c: Json) => delete c.models.extraction],
    [
      'fallback used without a primary error',
      (c: Json) => (c.models.analysis.fallback_used = true)
    ],
    ['a primary error without fallback', (c: Json) => (c.models.analysis.primary_error = 'boom')],
    ['a configured-model field', (c: Json) => (c.models.analysis.configured_model = 'x')],
    ['null analysis model while analysis exists', (c: Json) => (c.models.analysis = null)]
  ])('rejects %s', (_name, mutate) => {
    expect(analyzeCallbackSchema.safeParse(variant(succeeded, mutate)).success).toBe(false);
  });

  it('accepts a fallback execution that records the primary error', () => {
    const fallback = variant(succeeded, (c) => {
      c.models.analysis = {
        model: 'fixture-analysis-fallback-model',
        provider: 'fixture-provider',
        fallback_used: true,
        primary_error: 'synthetic primary failure'
      };
    });
    expect(analyzeCallbackSchema.safeParse(fallback).success).toBe(true);
  });
});

describe('ujh.analyze.v1 failure callback', () => {
  it('accepts a failure', () => {
    expect(analyzeCallbackSchema.safeParse(failed).success).toBe(true);
  });

  it('rejects LISTING_INCOMPLETE as a workflow error code', () => {
    const listingIncomplete = variant(failed, (c) => (c.error.code = 'LISTING_INCOMPLETE'));
    expect(analyzeCallbackSchema.safeParse(listingIncomplete).success).toBe(false);
  });

  it('rejects an unknown error stage', () => {
    const unknownStage = variant(failed, (c) => (c.error.stage = 'Claude Opportunity Analyst'));
    expect(analyzeCallbackSchema.safeParse(unknownStage).success).toBe(false);
  });
});

describe('hard-filter reasons', () => {
  it.each([
    ['US_FREELANCERS_EXCLUDED', 'US_FREELANCERS_EXCLUDED'],
    ['PAYMENT_EXPLICITLY_UNVERIFIED', 'PAYMENT_EXPLICITLY_UNVERIFIED'],
    ['LIKELY_SCAM', 'LIKELY_SCAM'],
    ['LIKELY_SCAM: asks to move off platform', 'LIKELY_SCAM'],
    ['REFUSED_CONDITION: unpaid test or unpaid trial work', 'REFUSED_CONDITION'],
    ['INCOMPLETE_LISTING', 'INCOMPLETE_LISTING']
  ])('accepts the live reason "%s"', (reason, code) => {
    expect(hardFilterReasonSchema.safeParse(reason).success).toBe(true);
    expect(hardFilterReasonCode(reason)).toBe(code);
  });

  it.each([
    'LISTING_INCOMPLETE',
    'REFUSED_CONDITION',
    'INCOMPLETE_LISTING: short',
    'incomplete_listing'
  ])('rejects "%s"', (reason) => {
    expect(hardFilterReasonSchema.safeParse(reason).success).toBe(false);
  });
});
