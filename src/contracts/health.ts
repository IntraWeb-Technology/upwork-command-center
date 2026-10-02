import { z } from 'zod';

import { timestampSchema, workflowVersionSchema } from './common';

export const HEALTH_CONTRACT = 'ujh.health.v1';

// Synchronous diagnostic: no LLM calls, no business state, no callback.

export const healthRequestSchema = z.strictObject({
  contract: z.literal(HEALTH_CONTRACT),
  requested_at: timestampSchema
});
export type HealthRequest = z.infer<typeof healthRequestSchema>;

// Null means the workflow is not deployed or not active.
const deployedVersionSchema = workflowVersionSchema.nullable();

export const healthResponseSchema = z
  .strictObject({
    contract: z.literal(HEALTH_CONTRACT),
    status: z.enum(['ok', 'degraded']),
    checked_at: timestampSchema,
    workflows: z.strictObject({
      analyze: deployedVersionSchema,
      generate_proposal: deployedVersionSchema,
      post_callback: deployedVersionSchema
    })
  })
  .refine(
    (response) =>
      (response.status === 'ok') === Object.values(response.workflows).every((v) => v !== null),
    { message: 'status must be ok exactly when every workflow reports a version', path: ['status'] }
  );
export type HealthResponse = z.infer<typeof healthResponseSchema>;
