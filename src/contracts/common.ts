import { z } from 'zod';

export const CONTRACT_IDS = [
  'ujh.analyze.v1',
  'ujh.generate_proposal.v1',
  'ujh.health.v1'
] as const;
export const contractIdSchema = z.enum(CONTRACT_IDS);
export type ContractId = z.infer<typeof contractIdSchema>;

// Opaque on purpose: the database (and therefore UUIDv7 vs ULID) is not chosen yet.
// Both formats, and any other URL-safe identifier, satisfy this pattern.
export const entityIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'must be an opaque URL-safe identifier');
export type EntityId = z.infer<typeof entityIdSchema>;

export const runIdSchema = entityIdSchema;

export const timestampSchema = z.iso.datetime({ offset: true });

// Single-use secret generated per run. Never logged; only its hash is persisted.
export const callbackTokenSchema = z.string().min(32).max(512);

export const callbackConfigSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  token: callbackTokenSchema
});
export type CallbackConfig = z.infer<typeof callbackConfigSchema>;

// Opaque n8n execution reference for debugging links only.
export const executionRefSchema = z.string().min(1).max(128).nullable();

export const dispatchBaseShape = {
  run_id: runIdSchema,
  requested_at: timestampSchema,
  callback: callbackConfigSchema
};

export const callbackBaseShape = {
  run_id: runIdSchema,
  callback_token: callbackTokenSchema,
  completed_at: timestampSchema,
  execution_ref: executionRefSchema
};

export const ERROR_CODES = [
  'INVALID_INPUT',
  'UPSTREAM_UNAVAILABLE',
  'MODEL_ERROR',
  'MODEL_OUTPUT_INVALID',
  'TIMEOUT',
  'INTERNAL'
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

const STACK_FRAME = /\n\s+at\s/;

export const errorMessageSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine((message) => !STACK_FRAME.test(message), 'must not contain a stack trace');

export function workflowErrorSchema<const Stages extends readonly [string, ...string[]]>(
  stages: Stages
) {
  return z.strictObject({
    code: errorCodeSchema,
    stage: z.enum(stages).nullable(),
    message: errorMessageSchema,
    retryable: z.boolean()
  });
}

// Synchronous acknowledgement returned by a CC webhook before processing continues.
export const dispatchAcceptedSchema = z.strictObject({
  accepted: z.literal(true),
  run_id: runIdSchema,
  execution_ref: executionRefSchema
});

export const dispatchRejectedSchema = z.strictObject({
  accepted: z.literal(false),
  error: z.strictObject({
    code: z.literal('INVALID_INPUT'),
    message: errorMessageSchema
  })
});

export const dispatchAcknowledgementSchema = z.discriminatedUnion('accepted', [
  dispatchAcceptedSchema,
  dispatchRejectedSchema
]);
export type DispatchAcknowledgement = z.infer<typeof dispatchAcknowledgementSchema>;

export const modelExecutionSchema = z
  .strictObject({
    model: z.string().min(1).max(200),
    provider: z.string().min(1).max(100).nullable(),
    fallback_used: z.boolean(),
    primary_error: z.string().min(1).max(500).nullable()
  })
  .refine((execution) => execution.fallback_used === (execution.primary_error !== null), {
    message: 'primary_error is required exactly when fallback_used is true',
    path: ['primary_error']
  });
export type ModelExecution = z.infer<typeof modelExecutionSchema>;

export const workflowVersionSchema = z.string().min(1).max(100);
export const promptVersionSchema = z.string().min(1).max(100);
export const profileHashSchema = z
  .string()
  .regex(/^[a-f0-9]{8,64}$/, 'must be a lowercase hex hash');
