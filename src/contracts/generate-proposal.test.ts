import { describe, expect, it } from 'vitest';

import { cloneFixture, loadFixture, type MutableJson as Json } from '@/test/contract-fixtures';

import {
  generateProposalCallbackSchema,
  generateProposalRequestSchema,
  proposalPlanSchema
} from './generate-proposal';

const initial = loadFixture('generate_proposal', 'valid', 'request.initial.json') as Json;
const regenerate = loadFixture('generate_proposal', 'valid', 'request.regenerate.json') as Json;
const succeeded = loadFixture('generate_proposal', 'valid', 'callback.succeeded.json') as Json;
const regenerated = loadFixture(
  'generate_proposal',
  'valid',
  'callback.succeeded-regenerated.json'
) as Json;
const failed = loadFixture('generate_proposal', 'valid', 'callback.failed.json') as Json;

function variant(base: Json, mutate: (value: Json) => void): Json {
  const copy = cloneFixture(base);
  mutate(copy);
  return copy;
}

describe('ujh.generate_proposal.v1 request', () => {
  it('accepts an initial generation request', () => {
    const parsed = generateProposalRequestSchema.parse(initial);
    expect(parsed.base_version).toBeNull();
    expect(parsed.instructions).toBeNull();
  });

  it('accepts a regeneration request with base version and instructions', () => {
    const parsed = generateProposalRequestSchema.parse(regenerate);
    expect(parsed.base_version?.number).toBe(1);
    expect(parsed.instructions).toMatch(/opening/);
  });

  it('accepts a request without analysis context', () => {
    const noAnalysis = variant(initial, (r) => (r.analysis = null));
    expect(generateProposalRequestSchema.safeParse(noAnalysis).success).toBe(true);
  });

  it.each([
    ['a different contract version', (r: Json) => (r.contract = 'ujh.generate_proposal.v2')],
    ['the analyze contract id', (r: Json) => (r.contract = 'ujh.analyze.v1')],
    ['a Slack thread', (r: Json) => (r.slack_thread_ts = '1700000000.000100')],
    ['a workflow status', (r: Json) => (r.status = 'READY_TO_SUBMIT')],
    ['an n8n-assigned version number', (r: Json) => (r.proposal_version = 2)],
    ['eligibility forcing', (r: Json) => (r.force_generate = true)],
    ['blank instructions', (r: Json) => (r.instructions = '   ')],
    ['a base version number of 0', (r: Json) => (r.base_version = { number: 0, body: 'x' })],
    ['an unknown job category', (r: Json) => (r.job.job_category = 'WORDPRESS')],
    ['an extra analysis field', (r: Json) => (r.analysis.proposal_strategy = 'x')]
  ])('rejects %s', (_name, mutate) => {
    expect(generateProposalRequestSchema.safeParse(variant(initial, mutate)).success).toBe(false);
  });
});

describe('ujh.generate_proposal.v1 success callback', () => {
  it('accepts a generated proposal', () => {
    expect(generateProposalCallbackSchema.safeParse(succeeded).success).toBe(true);
  });

  it('keeps strategy and writer model metadata independent', () => {
    const parsed = generateProposalCallbackSchema.parse(regenerated);
    if (parsed.status !== 'succeeded') throw new Error('expected success');
    expect(parsed.models.strategy).toEqual({
      model: 'fixture-strategy-model',
      provider: null,
      fallback_used: false,
      primary_error: null
    });
    expect(parsed.models.writer.fallback_used).toBe(true);
    expect(parsed.models.writer.model).not.toBe(parsed.models.strategy.model);
  });

  it('rejects a combined "strategy + writer" model label', () => {
    const combined = variant(succeeded, (c) => {
      c.models = { proposal: 'strategy + writer', fallback_used: false };
    });
    expect(generateProposalCallbackSchema.safeParse(combined).success).toBe(false);
  });

  it('records em dashes removed as diagnostic metadata', () => {
    const parsed = generateProposalCallbackSchema.parse(regenerated);
    expect(parsed.status === 'succeeded' && parsed.result.sanitizer.em_dashes_removed).toBe(2);
  });

  it.each([
    ['an em dash in the body', (c: Json) => (c.result.body = `${c.result.body} \u2014 extra`)],
    ['a blank body', (c: Json) => (c.result.body = '   ')],
    ['a missing sanitizer count', (c: Json) => delete c.result.sanitizer.em_dashes_removed],
    ['a negative sanitizer count', (c: Json) => (c.result.sanitizer.em_dashes_removed = -1)],
    [
      'a writer fallback without a primary error',
      (c: Json) => (c.models.writer.fallback_used = true)
    ],
    ['missing versions', (c: Json) => delete c.versions],
    ['a missing writer prompt version', (c: Json) => delete c.versions.proposal_writer_prompt],
    ['a version number from n8n', (c: Json) => (c.result.proposal_version = 1)]
  ])('rejects %s', (_name, mutate) => {
    expect(generateProposalCallbackSchema.safeParse(variant(succeeded, mutate)).success).toBe(
      false
    );
  });
});

describe('proposal plan', () => {
  const plan = succeeded.result.strategy as Json;

  it('accepts the live 11-field plan', () => {
    expect(Object.keys(plan)).toHaveLength(11);
    expect(proposalPlanSchema.safeParse(plan).success).toBe(true);
  });

  it.each([
    ['a missing opening hook', (p: Json) => delete p.opening_hook],
    ['a blank proposal angle', (p: Json) => (p.proposal_angle = ' ')],
    ['a string case-study flag', (p: Json) => (p.include_case_study_link = 'yes')],
    ['key points as a string', (p: Json) => (p.key_points = 'one, two')],
    ['an extra field', (p: Json) => (p.strengths = ['x'])]
  ])('rejects %s', (_name, mutate) => {
    expect(proposalPlanSchema.safeParse(variant(plan, mutate)).success).toBe(false);
  });
});

describe('ujh.generate_proposal.v1 failure callback', () => {
  it('accepts a failure', () => {
    expect(generateProposalCallbackSchema.safeParse(failed).success).toBe(true);
  });

  it('rejects an analyze-only error stage', () => {
    const wrongStage = variant(failed, (c) => (c.error.stage = 'scoring'));
    expect(generateProposalCallbackSchema.safeParse(wrongStage).success).toBe(false);
  });

  it.each([
    ['a missing run id', (c: Json) => delete c.run_id],
    ['a missing callback token', (c: Json) => delete c.callback_token],
    ['a non-ISO completion time', (c: Json) => (c.completed_at = 'yesterday')],
    ['an unknown status', (c: Json) => (c.status = 'timed_out')]
  ])('rejects a malformed callback with %s', (_name, mutate) => {
    expect(generateProposalCallbackSchema.safeParse(variant(failed, mutate)).success).toBe(false);
  });
});
