import { describe, expect, it } from 'vitest';

import { cloneFixture, loadFixture, type MutableJson as Json } from '@/test/contract-fixtures';

import { callbackEnvelopeSchema } from './callback';
import { contractIdSchema, errorCodeSchema } from './common';

const analyzeSucceeded = loadFixture('analyze', 'valid', 'callback.succeeded.json') as Json;
const analyzeFailed = loadFixture('analyze', 'valid', 'callback.failed.json') as Json;
const proposalSucceeded = loadFixture(
  'generate_proposal',
  'valid',
  'callback.succeeded.json'
) as Json;
const proposalFailed = loadFixture('generate_proposal', 'valid', 'callback.failed.json') as Json;

function variant(base: Json, mutate: (value: Json) => void): Json {
  const copy = cloneFixture(base);
  mutate(copy);
  return copy;
}

describe('contract ids', () => {
  it('is the closed set of v1 contracts', () => {
    expect(contractIdSchema.options).toEqual([
      'ujh.analyze.v1',
      'ujh.generate_proposal.v1',
      'ujh.health.v1'
    ]);
  });

  it('does not define an intake contract yet', () => {
    expect(contractIdSchema.safeParse('ujh.intake_scan.v1').success).toBe(false);
  });
});

describe('callback envelope', () => {
  it.each([
    ['analyze success', analyzeSucceeded],
    ['analyze failure', analyzeFailed],
    ['proposal success', proposalSucceeded],
    ['proposal failure', proposalFailed]
  ])('accepts %s', (_name, payload) => {
    expect(callbackEnvelopeSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects an unexpected contract version', () => {
    const v2 = variant(analyzeSucceeded, (c) => (c.contract = 'ujh.analyze.v2'));
    expect(callbackEnvelopeSchema.safeParse(v2).success).toBe(false);
  });

  it('rejects the synchronous health contract as a callback', () => {
    const health = variant(analyzeFailed, (c) => (c.contract = 'ujh.health.v1'));
    expect(callbackEnvelopeSchema.safeParse(health).success).toBe(false);
  });

  it('rejects an analyze result labelled as a proposal callback', () => {
    const mislabelled = variant(analyzeSucceeded, (c) => (c.contract = 'ujh.generate_proposal.v1'));
    expect(callbackEnvelopeSchema.safeParse(mislabelled).success).toBe(false);
  });
});

describe('failure envelope', () => {
  it('lists the approved error codes only', () => {
    expect(errorCodeSchema.options).toEqual([
      'INVALID_INPUT',
      'UPSTREAM_UNAVAILABLE',
      'MODEL_ERROR',
      'MODEL_OUTPUT_INVALID',
      'TIMEOUT',
      'INTERNAL'
    ]);
  });

  it.each(['LISTING_INCOMPLETE', 'INCOMPLETE_LISTING', 'UNKNOWN', 'model_error'])(
    'rejects the error code %s',
    (code) => {
      expect(
        callbackEnvelopeSchema.safeParse(variant(analyzeFailed, (c) => (c.error.code = code)))
          .success
      ).toBe(false);
    }
  );

  it('accepts a null stage', () => {
    const noStage = variant(analyzeFailed, (c) => (c.error.stage = null));
    expect(callbackEnvelopeSchema.safeParse(noStage).success).toBe(true);
  });

  it('rejects a stack trace in the message', () => {
    const stack = variant(analyzeFailed, (c) => {
      c.error.message = 'Error: boom\n    at Object.<anonymous> (/srv/n8n/node.js:1:1)';
    });
    expect(callbackEnvelopeSchema.safeParse(stack).success).toBe(false);
  });

  it('rejects an error without retryable', () => {
    const noRetryable = variant(analyzeFailed, (c) => delete c.error.retryable);
    expect(callbackEnvelopeSchema.safeParse(noRetryable).success).toBe(false);
  });

  it.each([
    ['analyze', analyzeSucceeded],
    ['proposal', proposalSucceeded]
  ])('rejects a %s success payload marked failed', (_name, payload) => {
    const masquerade = variant(payload, (c) => (c.status = 'failed'));
    expect(callbackEnvelopeSchema.safeParse(masquerade).success).toBe(false);
  });

  it.each([
    ['analyze', analyzeFailed],
    ['proposal', proposalFailed]
  ])('rejects a %s failure payload marked succeeded', (_name, payload) => {
    const masquerade = variant(payload, (c) => (c.status = 'succeeded'));
    expect(callbackEnvelopeSchema.safeParse(masquerade).success).toBe(false);
  });

  it('rejects a failure that also carries a result', () => {
    const both = variant(analyzeFailed, (c) => (c.result = analyzeSucceeded.result));
    expect(callbackEnvelopeSchema.safeParse(both).success).toBe(false);
  });
});
