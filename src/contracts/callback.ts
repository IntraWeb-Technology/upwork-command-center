import { z } from 'zod';

import { analyzeCallbackSchema } from './analyze';
import { generateProposalCallbackSchema } from './generate-proposal';

// Everything the future callback route can receive, discriminated by contract then status.
export const callbackEnvelopeSchema = z.discriminatedUnion('contract', [
  analyzeCallbackSchema,
  generateProposalCallbackSchema
]);
export type CallbackEnvelope = z.infer<typeof callbackEnvelopeSchema>;
