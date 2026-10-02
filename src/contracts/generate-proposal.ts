import { z } from 'zod';

import { budgetTypeSchema, jobCategorySchema } from './analyze';
import {
  callbackBaseShape,
  dispatchBaseShape,
  entityIdSchema,
  modelExecutionSchema,
  profileHashSchema,
  promptVersionSchema,
  workflowErrorSchema,
  workflowVersionSchema
} from './common';

export const GENERATE_PROPOSAL_CONTRACT = 'ujh.generate_proposal.v1';

export const PROPOSAL_ERROR_STAGES = [
  'input',
  'config',
  'strategy',
  'writer',
  'validation'
] as const;
export const proposalErrorSchema = workflowErrorSchema(PROPOSAL_ERROR_STAGES);

const nonBlank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((text) => text.trim().length > 0, 'must not be blank');

// Request: exactly what the live strategist and writer prompts read today.
// Every Command Center run is an explicit owner request, so no eligibility input exists.

export const proposalJobSchema = z.strictObject({
  id: entityIdSchema,
  title: z.string().nullable(),
  job_category: jobCategorySchema.nullable(),
  budget_type: budgetTypeSchema.nullable(),
  budget_min: z.number().nullable(),
  budget_max: z.number().nullable(),
  hourly_min: z.number().nullable(),
  hourly_max: z.number().nullable(),
  connect_cost: z.number().nullable()
});

export const proposalAnalysisContextSchema = z.strictObject({
  id: entityIdSchema,
  client_problem: z.string(),
  recommended_positioning: z.string(),
  why_candidate_matches: z.array(z.string()),
  positive_signals: z.array(z.string()),
  red_flags: z.array(z.string()),
  missing_information: z.array(z.string()),
  analysis_summary: z.string()
});

export const proposalBaseVersionSchema = z.strictObject({
  // Informational for the prompt; the Command Center owns version numbering.
  number: z.number().int().min(1),
  body: nonBlank(20_000)
});

export const generateProposalRequestSchema = z.strictObject({
  contract: z.literal(GENERATE_PROPOSAL_CONTRACT),
  ...dispatchBaseShape,
  job: proposalJobSchema,
  listing: z.strictObject({
    id: entityIdSchema,
    text: nonBlank(100_000)
  }),
  // Null when the owner requests a proposal for a job without a completed analysis
  // (for example after a hard-filter rejection).
  analysis: proposalAnalysisContextSchema.nullable(),
  base_version: proposalBaseVersionSchema.nullable(),
  instructions: nonBlank(4000).nullable()
});
export type GenerateProposalRequest = z.infer<typeof generateProposalRequestSchema>;

// Result

// The live 11-field plan produced by the strategist (W03 Proposal Parser).
export const proposalPlanSchema = z.strictObject({
  client_real_problem: z.string(),
  proposal_angle: nonBlank(2000),
  opening_hook: nonBlank(2000),
  relevant_experience: z.array(z.string()),
  key_points: z.array(z.string()),
  technical_details: z.array(z.string()),
  recommended_case_study: z.string(),
  include_case_study_link: z.boolean(),
  recommended_bid_strategy: z.string(),
  questions_to_client: z.array(z.string()),
  risk_to_address: z.string()
});
export type ProposalPlan = z.infer<typeof proposalPlanSchema>;

export const proposalBodySchema = nonBlank(20_000).regex(
  /^[^\u2014]*$/,
  'must not contain an em dash'
);

export const generateProposalResultSchema = z.strictObject({
  body: proposalBodySchema,
  strategy: proposalPlanSchema,
  sanitizer: z.strictObject({
    // Diagnostic only. Integrity is enforced by the Command Center recomputing the body.
    em_dashes_removed: z.number().int().min(0)
  })
});
export type GenerateProposalResult = z.infer<typeof generateProposalResultSchema>;

// Execution metadata

export const proposalVersionsSchema = z.strictObject({
  workflow: workflowVersionSchema,
  proposal_strategy_prompt: promptVersionSchema,
  proposal_writer_prompt: promptVersionSchema,
  profile_hash: profileHashSchema
});
export type ProposalVersions = z.infer<typeof proposalVersionsSchema>;

export const proposalModelsSchema = z.strictObject({
  strategy: modelExecutionSchema,
  writer: modelExecutionSchema
});
export type ProposalModels = z.infer<typeof proposalModelsSchema>;

// Callback

export const generateProposalSucceededSchema = z.strictObject({
  contract: z.literal(GENERATE_PROPOSAL_CONTRACT),
  ...callbackBaseShape,
  status: z.literal('succeeded'),
  versions: proposalVersionsSchema,
  models: proposalModelsSchema,
  result: generateProposalResultSchema
});

export const generateProposalFailedSchema = z.strictObject({
  contract: z.literal(GENERATE_PROPOSAL_CONTRACT),
  ...callbackBaseShape,
  status: z.literal('failed'),
  error: proposalErrorSchema
});

export const generateProposalCallbackSchema = z.discriminatedUnion('status', [
  generateProposalSucceededSchema,
  generateProposalFailedSchema
]);
export type GenerateProposalCallback = z.infer<typeof generateProposalCallbackSchema>;
