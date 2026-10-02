import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue
} from 'drizzle-orm/pg-core';

// Loaded by drizzle-kit outside Next.js, so this file must not import server-only or '@/' paths.

export const WORKFLOW_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export const workflowRunStatus = pgEnum('workflow_run_status', WORKFLOW_RUN_STATUSES);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

// Closed vocabularies. The contract-owned ones (dimensions, dispositions) are duplicated here
// because drizzle-kit cannot import '@/contracts'; a unit test keeps them in sync.

export const JOB_ORIGINS = ['manual_paste', 'email_alert'] as const;
export const JOB_STAGES = [
  'discovered',
  'screened_out',
  'dismissed',
  'reviewing',
  'declined',
  'drafting',
  'submitted',
  'responded',
  'interviewing',
  'won',
  'lost',
  'withdrawn'
] as const;
export const JOB_EVENT_TYPES = [
  'JOB_CREATED',
  'LISTING_ADDED',
  'ANALYSIS_STARTED',
  'ANALYZED',
  'DECLINED',
  'ANALYSIS_OVERRIDE'
] as const;
export const EVENT_ACTORS = ['owner', 'system', 'n8n'] as const;
export const DISPOSITIONS = ['PRIORITY', 'REVIEW', 'LOW'] as const;
export const SCORE_DIMENSION_NAMES = [
  'technical_fit',
  'budget_score',
  'client_quality',
  'long_term_potential',
  'communication_quality',
  'competition_score',
  'strategic_fit'
] as const;

const sha256Check = (column: AnyPgColumn) => sql`${column} ~ '^[0-9a-f]{64}$'`;

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    upworkRef: text('upwork_ref'),
    fingerprint: text('fingerprint'),
    title: text('title').notNull(),
    url: text('url'),
    origin: text('origin').$type<(typeof JOB_ORIGINS)[number]>().notNull(),
    stage: text('stage').$type<(typeof JOB_STAGES)[number]>().notNull(),
    closeReason: text('close_reason'),
    currentAnalysisId: uuid('current_analysis_id'),
    manualScore: doublePrecision('manual_score'),
    manualDisposition: text('manual_disposition').$type<(typeof DISPOSITIONS)[number]>(),
    overrideReason: text('override_reason'),
    dismissReason: text('dismiss_reason'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull()
  },
  (table): PgTableExtraConfigValue[] => [
    // Composite so the current analysis must belong to this job.
    foreignKey({
      name: 'jobs_current_analysis_fk',
      columns: [table.currentAnalysisId, table.id],
      foreignColumns: [jobAnalyses.id, jobAnalyses.jobId]
    }),
    uniqueIndex('jobs_upwork_ref_unique')
      .on(table.upworkRef)
      .where(sql`${table.upworkRef} is not null`),
    index('jobs_updated_at_idx').on(table.updatedAt),
    check('jobs_origin_check', inList(table.origin, JOB_ORIGINS)),
    check('jobs_stage_check', inList(table.stage, JOB_STAGES)),
    check(
      'jobs_manual_disposition_check',
      sql`${table.manualDisposition} is null or ${inList(table.manualDisposition, DISPOSITIONS)}`
    ),
    check(
      'jobs_manual_score_check',
      sql`${table.manualScore} is null or (${table.manualScore} >= 1 and ${table.manualScore} <= 10)`
    ),
    check('jobs_title_check', sql`length(btrim(${table.title})) between 1 and 300`)
  ]
);

/** Immutable snapshots of pasted listing text. The only place listing text is stored. */
export const jobListings = pgTable(
  'job_listings',
  {
    id: uuid('id').primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references((): AnyPgColumn => jobs.id),
    rawText: text('raw_text').notNull(),
    // sha256 of the normalized text (see src/server/jobs/listing-text.ts).
    textHash: text('text_hash').notNull(),
    sourceUrl: text('source_url'),
    charCount: integer('char_count').notNull(),
    createdAt: timestamptz('created_at').notNull()
  },
  (table): PgTableExtraConfigValue[] => [
    unique('job_listings_id_job_unique').on(table.id, table.jobId),
    index('job_listings_job_created_idx').on(table.jobId, table.createdAt),
    check('job_listings_text_hash_check', sha256Check(table.textHash)),
    check('job_listings_char_count_check', sql`${table.charCount} > 0`)
  ]
);

/** Content-addressed execution configuration reported by a callback. */
export const configSnapshots = pgTable(
  'config_snapshots',
  {
    id: uuid('id').primaryKey(),
    contentHash: text('content_hash').notNull().unique('config_snapshots_content_hash_unique'),
    workflowVersion: text('workflow_version').notNull(),
    scoringVersion: text('scoring_version').notNull(),
    extractionPromptVersion: text('extraction_prompt_version').notNull(),
    analysisPromptVersion: text('analysis_prompt_version').notNull(),
    profileHash: text('profile_hash').notNull(),
    scoringWeights: jsonb('scoring_weights').notNull(),
    scoreThresholds: jsonb('score_thresholds').notNull(),
    hardFilterRules: jsonb('hard_filter_rules').notNull(),
    // Models that actually executed (identity only; per-run fallback details live on the analysis).
    models: jsonb('models').notNull(),
    firstSeenAt: timestamptz('first_seen_at').notNull()
  },
  (table): PgTableExtraConfigValue[] => [
    check('config_snapshots_content_hash_check', sha256Check(table.contentHash))
  ]
);

/** Immutable analysis results. A hard-filter rejection is a successful analysis without scores. */
export const jobAnalyses = pgTable(
  'job_analyses',
  {
    id: uuid('id').primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references((): AnyPgColumn => jobs.id),
    listingId: uuid('listing_id').notNull(),
    workflowRunId: uuid('workflow_run_id')
      .notNull()
      .references((): AnyPgColumn => workflowRuns.id)
      .unique('job_analyses_workflow_run_unique'),
    configSnapshotId: uuid('config_snapshot_id')
      .notNull()
      .references((): AnyPgColumn => configSnapshots.id),
    extractionStatus: text('extraction_status').$type<'ok' | 'failed'>().notNull(),
    extractionError: text('extraction_error'),
    // ujh.analyze.v1 extraction facts, validated; null when extraction failed.
    facts: jsonb('facts'),
    hardFilterPass: boolean('hard_filter_pass').notNull(),
    hardFilterReasons: text('hard_filter_reasons').array().notNull(),
    weightedScore: doublePrecision('weighted_score'),
    redFlagPenalty: doublePrecision('red_flag_penalty'),
    systemScore: doublePrecision('system_score'),
    systemDisposition: text('system_disposition').$type<(typeof DISPOSITIONS)[number]>(),
    redFlags: text('red_flags').array(),
    positiveSignals: text('positive_signals').array(),
    clientProblem: text('client_problem'),
    whyCandidateMatches: text('why_candidate_matches').array(),
    missingInformation: text('missing_information').array(),
    recommendedPositioning: text('recommended_positioning'),
    clientSummary: text('client_summary'),
    analysisSummary: text('analysis_summary'),
    extractionModel: text('extraction_model').notNull(),
    extractionProvider: text('extraction_provider'),
    extractionFallbackUsed: boolean('extraction_fallback_used').notNull(),
    analysisModel: text('analysis_model'),
    analysisProvider: text('analysis_provider'),
    analysisFallbackUsed: boolean('analysis_fallback_used'),
    completedAt: timestamptz('completed_at').notNull(),
    rawResult: jsonb('raw_result'),
    createdAt: timestamptz('created_at').notNull()
  },
  (table): PgTableExtraConfigValue[] => [
    unique('job_analyses_id_job_unique').on(table.id, table.jobId),
    foreignKey({
      name: 'job_analyses_listing_fk',
      columns: [table.listingId, table.jobId],
      foreignColumns: [jobListings.id, jobListings.jobId]
    }),
    index('job_analyses_job_created_idx').on(table.jobId, table.createdAt),
    check(
      'job_analyses_extraction_check',
      sql`case ${table.extractionStatus}
        when 'ok' then ${table.facts} is not null and ${table.extractionError} is null
        when 'failed' then ${table.facts} is null and ${table.extractionError} is not null
        else false
      end`
    ),
    check(
      'job_analyses_hard_filter_check',
      sql`${table.hardFilterPass} = (cardinality(${table.hardFilterReasons}) = 0)`
    ),
    // The analysis block is all present exactly when the hard filter passed.
    check(
      'job_analyses_analysis_check',
      sql`case when ${table.hardFilterPass} then
          ${table.systemScore} is not null and ${table.systemDisposition} is not null
          and ${table.weightedScore} is not null and ${table.redFlagPenalty} is not null
          and ${table.analysisModel} is not null and ${table.analysisFallbackUsed} is not null
          and ${table.analysisSummary} is not null
        else
          ${table.systemScore} is null and ${table.systemDisposition} is null
          and ${table.weightedScore} is null and ${table.analysisModel} is null
        end`
    ),
    check(
      'job_analyses_system_disposition_check',
      sql`${table.systemDisposition} is null or ${inList(table.systemDisposition, DISPOSITIONS)}`
    ),
    check(
      'job_analyses_system_score_check',
      sql`${table.systemScore} is null or (${table.systemScore} >= 1 and ${table.systemScore} <= 10)`
    )
  ]
);

export const analysisScores = pgTable(
  'analysis_scores',
  {
    analysisId: uuid('analysis_id')
      .notNull()
      .references((): AnyPgColumn => jobAnalyses.id),
    dimension: text('dimension').$type<(typeof SCORE_DIMENSION_NAMES)[number]>().notNull(),
    score: doublePrecision('score').notNull(),
    weight: doublePrecision('weight').notNull(),
    evidence: text('evidence')
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'analysis_scores_pk', columns: [table.analysisId, table.dimension] }),
    check('analysis_scores_dimension_check', inList(table.dimension, SCORE_DIMENSION_NAMES)),
    check('analysis_scores_score_check', sql`${table.score} >= 0 and ${table.score} <= 10`),
    check('analysis_scores_weight_check', sql`${table.weight} >= 0 and ${table.weight} <= 1`)
  ]
);

/** Append-only job history. */
export const jobEvents = pgTable(
  'job_events',
  {
    id: uuid('id').primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references((): AnyPgColumn => jobs.id),
    type: text('type').$type<(typeof JOB_EVENT_TYPES)[number]>().notNull(),
    fromStage: text('from_stage').$type<(typeof JOB_STAGES)[number]>(),
    toStage: text('to_stage').$type<(typeof JOB_STAGES)[number]>(),
    actor: text('actor').$type<(typeof EVENT_ACTORS)[number]>().notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    workflowRunId: uuid('workflow_run_id').references((): AnyPgColumn => workflowRuns.id),
    payload: jsonb('payload').notNull().default({}),
    idempotencyKey: text('idempotency_key').unique('job_events_idempotency_key_unique')
  },
  (table): PgTableExtraConfigValue[] => [
    index('job_events_job_occurred_idx').on(table.jobId, table.occurredAt),
    check('job_events_type_check', inList(table.type, JOB_EVENT_TYPES)),
    check('job_events_actor_check', inList(table.actor, EVENT_ACTORS)),
    check(
      'job_events_stage_check',
      sql`(${table.fromStage} is null or ${inList(table.fromStage, JOB_STAGES)})
        and (${table.toStage} is null or ${inList(table.toStage, JOB_STAGES)})`
    )
  ]
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    // UUIDv7 generated by the application; this is the run_id sent to n8n.
    id: uuid('id').primaryKey(),
    contract: text('contract').notNull(),
    jobId: uuid('job_id').references((): AnyPgColumn => jobs.id),
    status: workflowRunStatus('status').notNull().default('queued'),
    // Sanitized summary of the dispatched request: never the callback token or full listing.
    request: jsonb('request').notNull(),
    // Transitional: validated versions, models, and result until domain tables exist.
    result: jsonb('result'),
    errorCode: text('error_code'),
    errorStage: text('error_stage'),
    errorMessage: text('error_message'),
    retryable: boolean('retryable'),
    callbackTokenHash: text('callback_token_hash').notNull(),
    n8nExecutionRef: text('n8n_execution_ref'),
    attempt: integer('attempt').notNull().default(1),
    retryOfRunId: uuid('retry_of_run_id'),
    requestedAt: timestamptz('requested_at').notNull(),
    dispatchedAt: timestamptz('dispatched_at'),
    finishedAt: timestamptz('finished_at'),
    deadlineAt: timestamptz('deadline_at').notNull()
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'workflow_runs_retry_of_run_id_fk',
      columns: [table.retryOfRunId],
      foreignColumns: [table.id]
    }),
    uniqueIndex('workflow_runs_retry_of_run_id_unique').on(table.retryOfRunId),
    index('workflow_runs_requested_at_idx').on(table.requestedAt),
    index('workflow_runs_job_idx').on(table.jobId, table.requestedAt),
    // At most one active run per job and contract.
    uniqueIndex('workflow_runs_active_job_contract_unique')
      .on(table.jobId, table.contract)
      .where(sql`${table.status} in ('queued', 'running') and ${table.jobId} is not null`),
    check(
      'workflow_runs_contract_check',
      sql`${table.contract} in ('ujh.analyze.v1', 'ujh.generate_proposal.v1')`
    ),
    check(
      'workflow_runs_callback_token_hash_check',
      sql`${table.callbackTokenHash} ~ '^[0-9a-f]{64}$'`
    ),
    check('workflow_runs_deadline_check', sql`${table.deadlineAt} > ${table.requestedAt}`),
    check(
      'workflow_runs_attempt_check',
      sql`${table.attempt} >= 1 and (${table.attempt} = 1) = (${table.retryOfRunId} is null)`
    ),
    check(
      'workflow_runs_error_code_check',
      sql`${table.errorCode} is null or ${table.errorCode} in ('INVALID_INPUT', 'UPSTREAM_UNAVAILABLE', 'MODEL_ERROR', 'MODEL_OUTPUT_INVALID', 'TIMEOUT', 'INTERNAL')`
    ),
    check(
      'workflow_runs_outcome_check',
      sql`case ${table.status}
        when 'succeeded' then ${table.finishedAt} is not null and ${table.result} is not null and ${table.errorCode} is null
        when 'failed' then ${table.finishedAt} is not null and ${table.result} is null and ${table.errorCode} is not null and ${table.errorMessage} is not null and ${table.retryable} is not null
        else ${table.finishedAt} is null and ${table.result} is null and ${table.errorCode} is null
      end`
    )
  ]
);

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type NewWorkflowRunRow = typeof workflowRuns.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type JobListingRow = typeof jobListings.$inferSelect;
export type JobAnalysisRow = typeof jobAnalyses.$inferSelect;
export type AnalysisScoreRow = typeof analysisScores.$inferSelect;
export type ConfigSnapshotRow = typeof configSnapshots.$inferSelect;
export type JobEventRow = typeof jobEvents.$inferSelect;
