import { describe, expect, it } from 'vitest';

import { cloneFixture, loadFixture, type MutableJson as Json } from '@/test/contract-fixtures';

import { healthRequestSchema, healthResponseSchema } from './health';

const request = loadFixture('health', 'valid', 'request.json') as Json;
const ok = loadFixture('health', 'valid', 'response.ok.json') as Json;
const degraded = loadFixture('health', 'valid', 'response.degraded.json') as Json;

function variant(base: Json, mutate: (value: Json) => void): Json {
  const copy = cloneFixture(base);
  mutate(copy);
  return copy;
}

describe('ujh.health.v1', () => {
  it('accepts a request', () => {
    expect(healthRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects a request carrying a callback', () => {
    const withCallback = variant(request, (r) => {
      r.callback = { url: 'https://command.example.com/cb', token: 'x'.repeat(32) };
    });
    expect(healthRequestSchema.safeParse(withCallback).success).toBe(false);
  });

  it('accepts a healthy response', () => {
    expect(healthResponseSchema.safeParse(ok).success).toBe(true);
  });

  it('accepts a degraded response when a workflow is missing', () => {
    expect(healthResponseSchema.safeParse(degraded).success).toBe(true);
  });

  it.each([
    ['ok with a missing workflow', (r: Json) => (r.workflows.generate_proposal = null), ok],
    [
      'degraded with every workflow present',
      (r: Json) => (r.workflows.generate_proposal = 'v1'),
      degraded
    ]
  ])('rejects %s', (_name, mutate, base) => {
    expect(healthResponseSchema.safeParse(variant(base, mutate)).success).toBe(false);
  });

  it.each([
    ['an execution id', (r: Json) => (r.execution_id = '123')],
    ['credentials', (r: Json) => (r.credentials = { token: 'x' })],
    ['node topology', (r: Json) => (r.nodes = ['Webhook'])],
    ['internal config', (r: Json) => (r.config = { environment: 'test' })],
    ['an unknown workflow', (r: Json) => (r.workflows.w01 = 'x')],
    [
      'workflow details beyond a version',
      (r: Json) => (r.workflows.analyze = { version: 'v1', id: 'abc' })
    ]
  ])('has no place for %s', (_name, mutate) => {
    expect(healthResponseSchema.safeParse(variant(ok, mutate)).success).toBe(false);
  });

  it('exposes only contract, status, time, and workflow versions', () => {
    expect(Object.keys(healthResponseSchema.shape).toSorted()).toEqual([
      'checked_at',
      'contract',
      'status',
      'workflows'
    ]);
  });
});
