import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { listFixtures } from '@/test/contract-fixtures';

import { analyzeCallbackSchema, analyzeRequestSchema } from './analyze';
import { callbackEnvelopeSchema } from './callback';
import { dispatchAcknowledgementSchema } from './common';
import { generateProposalCallbackSchema, generateProposalRequestSchema } from './generate-proposal';
import { healthRequestSchema, healthResponseSchema } from './health';

const schemaFor: Record<string, Record<string, z.ZodType>> = {
  analyze: { request: analyzeRequestSchema, callback: analyzeCallbackSchema },
  generate_proposal: {
    request: generateProposalRequestSchema,
    callback: generateProposalCallbackSchema
  },
  health: { request: healthRequestSchema, response: healthResponseSchema },
  dispatch: { acknowledgement: dispatchAcknowledgementSchema }
};

const fixtures = listFixtures();

describe('committed contract fixtures', () => {
  it('exist for every contract group', () => {
    const groups = new Set(fixtures.map((fixture) => fixture.group));
    expect([...groups].toSorted()).toEqual(Object.keys(schemaFor).toSorted());
  });

  it.each(
    fixtures.map((fixture) => [`${fixture.group}/${fixture.validity}/${fixture.file}`, fixture])
  )('%s', (_name, fixture) => {
    const schema = schemaFor[fixture.group]?.[fixture.kind];
    expect(schema, `no schema mapped for kind "${fixture.kind}"`).toBeDefined();
    const result = schema!.safeParse(fixture.data);
    if (fixture.validity === 'valid') {
      expect(result.error?.issues ?? []).toEqual([]);
    } else {
      expect(result.success).toBe(false);
    }
  });

  it('accepts every valid callback through the shared callback envelope', () => {
    for (const fixture of fixtures) {
      if (fixture.validity !== 'valid' || fixture.kind !== 'callback') continue;
      expect(callbackEnvelopeSchema.safeParse(fixture.data).success, fixture.file).toBe(true);
    }
  });
});
