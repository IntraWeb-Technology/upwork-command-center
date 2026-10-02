import { z } from 'zod';

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

export const ANALYZE_CONTRACT = 'ujh.analyze.v1';

// Vocabularies below mirror the live n8n parser schemas and expressions (W01/W02 exports).

export const JOB_CATEGORIES = [
  'NEXTJS_REACT',
  'SENIOR_FULL_STACK',
  'API_INTEGRATION',
  'AI_AUTOMATION',
  'QUICK_FIX',
  'OTHER'
] as const;
export const jobCategorySchema = z.enum(JOB_CATEGORIES);
export type JobCategory = z.infer<typeof jobCategorySchema>;

export const budgetTypeSchema = z.enum(['fixed', 'hourly']);

export const SCORE_DIMENSIONS = [
  'technical_fit',
  'budget_score',
  'client_quality',
  'long_term_potential',
  'communication_quality',
  'competition_score',
  'strategic_fit'
] as const;
export const scoreDimensionSchema = z.enum(SCORE_DIMENSIONS);
export type ScoreDimension = z.infer<typeof scoreDimensionSchema>;

function perDimension<T extends z.ZodType>(value: T) {
  return z.strictObject({
    technical_fit: value,
    budget_score: value,
    client_quality: value,
    long_term_potential: value,
    communication_quality: value,
    competition_score: value,
    strategic_fit: value
  });
}

export const SYSTEM_DISPOSITIONS = ['PRIORITY', 'REVIEW', 'LOW'] as const;
export const systemDispositionSchema = z.enum(SYSTEM_DISPOSITIONS);
export type SystemDisposition = z.infer<typeof systemDispositionSchema>;

export const HARD_FILTER_REASON_CODES = [
  'US_FREELANCERS_EXCLUDED',
  'PAYMENT_EXPLICITLY_UNVERIFIED',
  'LIKELY_SCAM',
  'REFUSED_CONDITION',
  'INCOMPLETE_LISTING'
] as const;
export const hardFilterReasonCodeSchema = z.enum(HARD_FILTER_REASON_CODES);
export type HardFilterReasonCode = z.infer<typeof hardFilterReasonCodeSchema>;

// Live reasons are strings; LIKELY_SCAM may carry ": <signals>" and REFUSED_CONDITION always
// carries ": <condition>". The code set is closed, the detail text is free-form.
export const hardFilterReasonSchema = z
  .string()
  .regex(
    /^(?:US_FREELANCERS_EXCLUDED|PAYMENT_EXPLICITLY_UNVERIFIED|INCOMPLETE_LISTING|LIKELY_SCAM(?:: .+)?|REFUSED_CONDITION: .+)$/,
    'must start with a known hard-filter reason code'
  );

export function hardFilterReasonCode(reason: string): HardFilterReasonCode {
  return hardFilterReasonCodeSchema.parse(reason.split(':', 1)[0]);
}

export const ANALYZE_ERROR_STAGES = ['input', 'config', 'analysis', 'scoring'] as const;
export const analyzeErrorSchema = workflowErrorSchema(ANALYZE_ERROR_STAGES);

// Request

export const analyzeRequestSchema = z.strictObject({
  contract: z.literal(ANALYZE_CONTRACT),
  ...dispatchBaseShape,
  job: z.strictObject({
    id: entityIdSchema,
    upwork_ref: z
      .string()
      .regex(/^~0[0-9a-z]{10,}$/, 'must be a lowercase Upwork ciphertext reference')
      .nullable(),
    source_url: z.url({ protocol: /^https?$/ }).nullable()
  }),
  input: z.strictObject({
    listing_id: entityIdSchema,
    // Short listings are valid input; the hard filter reports them as INCOMPLETE_LISTING.
    listing_text: z
      .string()
      .max(100_000)
      .refine((text) => text.trim().length > 0, 'listing_text must not be blank')
  })
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

// Result

export const extractionFactsSchema = z.strictObject({
  title: z.string().nullable(),
  posted_at: z.string().nullable(),
  budget_type: budgetTypeSchema.nullable(),
  budget_min: z.number().nullable(),
  budget_max: z.number().nullable(),
  hourly_min: z.number().nullable(),
  hourly_max: z.number().nullable(),
  connect_cost: z.number().nullable(),
  payment_verified: z.boolean().nullable(),
  client_location: z.string().nullable(),
  client_total_spend: z.number().nullable(),
  client_hires: z.number().nullable(),
  client_rating: z.number().nullable(),
  proposal_count: z.string().nullable(),
  proposals_min: z.number().nullable(),
  proposals_max: z.number().nullable(),
  skills: z.array(z.string()),
  job_category: jobCategorySchema,
  excludes_us_freelancers: z.boolean().nullable(),
  is_likely_scam: z.boolean(),
  scam_signals: z.array(z.string()),
  refused_conditions_found: z.array(
    z.strictObject({ condition: z.string().min(1), evidence: z.string() })
  ),
  listing_is_incomplete: z.boolean(),
  summary: z.string()
});
export type ExtractionFacts = z.infer<typeof extractionFactsSchema>;

export const extractionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    error: z.null(),
    facts: extractionFactsSchema
  }),
  // Extraction failure is not a workflow error: processing continues without facts.
  z.strictObject({
    status: z.literal('failed'),
    error: z.string().min(1).max(500),
    facts: z.null()
  })
]);
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const hardFilterResultSchema = z
  .strictObject({
    pass: z.boolean(),
    reasons: z.array(hardFilterReasonSchema)
  })
  .refine((filter) => filter.pass === (filter.reasons.length === 0), {
    message: 'pass must be true exactly when there are no reasons',
    path: ['pass']
  });
export type HardFilterResult = z.infer<typeof hardFilterResultSchema>;

const dimensionScoreSchema = z.number().min(0).max(10);

export const analysisSchema = z.strictObject({
  scores: perDimension(dimensionScoreSchema),
  dimension_evidence: perDimension(z.string()).partial(),
  weighted_score: z.number().min(0),
  red_flag_penalty: z.number().min(0).max(3),
  system_score: z.number().min(1).max(10),
  system_disposition: systemDispositionSchema,
  red_flags: z.array(z.string()),
  positive_signals: z.array(z.string()),
  client_problem: z.string(),
  why_candidate_matches: z.array(z.string()),
  missing_information: z.array(z.string()),
  recommended_positioning: z.string(),
  client_summary: z.string(),
  analysis_summary: z.string()
});
export type Analysis = z.infer<typeof analysisSchema>;

export const analyzeResultSchema = z
  .strictObject({
    extraction: extractionResultSchema,
    hard_filter: hardFilterResultSchema,
    analysis: analysisSchema.nullable()
  })
  .refine((result) => result.hard_filter.pass === (result.analysis !== null), {
    message: 'analysis must be null exactly when the hard filter failed',
    path: ['analysis']
  });
export type AnalyzeResult = z.infer<typeof analyzeResultSchema>;

// Execution metadata

export const scoringWeightsSchema = perDimension(z.number().min(0).max(1));

export const scoreThresholdsSchema = z
  .strictObject({
    priority: z.number().min(0).max(10),
    review: z.number().min(0).max(10)
  })
  .refine((thresholds) => thresholds.priority >= thresholds.review, {
    message: 'priority threshold must be at least the review threshold',
    path: ['priority']
  });

export const hardFilterRulesSchema = z.strictObject({
  reject_if_us_excluded: z.boolean(),
  require_verified_payment: z.boolean(),
  reject_likely_scam: z.boolean(),
  refused_conditions: z.array(z.string().min(1)),
  min_listing_chars: z.number().int().min(0)
});

export const analyzeVersionsSchema = z.strictObject({
  workflow: workflowVersionSchema,
  scoring: promptVersionSchema,
  extraction_prompt: promptVersionSchema,
  analysis_prompt: promptVersionSchema,
  profile_hash: profileHashSchema,
  scoring_weights: scoringWeightsSchema,
  score_thresholds: scoreThresholdsSchema,
  hard_filter_rules: hardFilterRulesSchema
});
export type AnalyzeVersions = z.infer<typeof analyzeVersionsSchema>;

export const analyzeModelsSchema = z.strictObject({
  extraction: modelExecutionSchema,
  // Null when the hard filter failed, because no analysis model executed.
  analysis: modelExecutionSchema.nullable()
});
export type AnalyzeModels = z.infer<typeof analyzeModelsSchema>;

// Callback

export const analyzeSucceededSchema = z
  .strictObject({
    contract: z.literal(ANALYZE_CONTRACT),
    ...callbackBaseShape,
    status: z.literal('succeeded'),
    versions: analyzeVersionsSchema,
    models: analyzeModelsSchema,
    result: analyzeResultSchema
  })
  .refine(
    (callback) => (callback.models.analysis === null) === (callback.result.analysis === null),
    {
      message: 'models.analysis must be null exactly when result.analysis is null',
      path: ['models', 'analysis']
    }
  );

export const analyzeFailedSchema = z.strictObject({
  contract: z.literal(ANALYZE_CONTRACT),
  ...callbackBaseShape,
  status: z.literal('failed'),
  error: analyzeErrorSchema
});

export const analyzeCallbackSchema = z.discriminatedUnion('status', [
  analyzeSucceededSchema,
  analyzeFailedSchema
]);
export type AnalyzeCallback = z.infer<typeof analyzeCallbackSchema>;
