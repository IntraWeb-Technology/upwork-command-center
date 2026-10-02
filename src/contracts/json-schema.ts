import { z } from 'zod';

import { analyzeCallbackSchema, analyzeRequestSchema } from './analyze';
import { dispatchAcknowledgementSchema } from './common';
import { generateProposalCallbackSchema, generateProposalRequestSchema } from './generate-proposal';
import { healthRequestSchema, healthResponseSchema } from './health';

export const JSON_SCHEMA_DIR = 'contracts/json-schema';

const exportedSchemas: ReadonlyArray<readonly [string, string, z.ZodType]> = [
  ['dispatch-acknowledgement.json', 'CC dispatch acknowledgement', dispatchAcknowledgementSchema],
  ['ujh.analyze.v1.request.json', 'ujh.analyze.v1 request', analyzeRequestSchema],
  ['ujh.analyze.v1.callback.json', 'ujh.analyze.v1 callback', analyzeCallbackSchema],
  [
    'ujh.generate_proposal.v1.request.json',
    'ujh.generate_proposal.v1 request',
    generateProposalRequestSchema
  ],
  [
    'ujh.generate_proposal.v1.callback.json',
    'ujh.generate_proposal.v1 callback',
    generateProposalCallbackSchema
  ],
  ['ujh.health.v1.request.json', 'ujh.health.v1 request', healthRequestSchema],
  ['ujh.health.v1.response.json', 'ujh.health.v1 response', healthResponseSchema]
];

// Cross-field rules (refinements) are not representable in JSON Schema; Zod remains authoritative.
export function buildContractJsonSchemas(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [fileName, title, schema] of exportedSchemas) {
    const jsonSchema = { title, ...z.toJSONSchema(schema, { target: 'draft-2020-12' }) };
    files[fileName] = `${JSON.stringify(jsonSchema, null, 2)}\n`;
  }
  return files;
}
