CREATE TABLE "analysis_scores" (
	"analysis_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"score" double precision NOT NULL,
	"weight" double precision NOT NULL,
	"evidence" text,
	CONSTRAINT "analysis_scores_pk" PRIMARY KEY("analysis_id","dimension"),
	CONSTRAINT "analysis_scores_dimension_check" CHECK ("analysis_scores"."dimension" in ('technical_fit', 'budget_score', 'client_quality', 'long_term_potential', 'communication_quality', 'competition_score', 'strategic_fit')),
	CONSTRAINT "analysis_scores_score_check" CHECK ("analysis_scores"."score" >= 0 and "analysis_scores"."score" <= 10),
	CONSTRAINT "analysis_scores_weight_check" CHECK ("analysis_scores"."weight" >= 0 and "analysis_scores"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "config_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"workflow_version" text NOT NULL,
	"scoring_version" text NOT NULL,
	"extraction_prompt_version" text NOT NULL,
	"analysis_prompt_version" text NOT NULL,
	"profile_hash" text NOT NULL,
	"scoring_weights" jsonb NOT NULL,
	"score_thresholds" jsonb NOT NULL,
	"hard_filter_rules" jsonb NOT NULL,
	"models" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "config_snapshots_content_hash_unique" UNIQUE("content_hash"),
	CONSTRAINT "config_snapshots_content_hash_check" CHECK ("config_snapshots"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "job_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"config_snapshot_id" uuid NOT NULL,
	"extraction_status" text NOT NULL,
	"extraction_error" text,
	"facts" jsonb,
	"hard_filter_pass" boolean NOT NULL,
	"hard_filter_reasons" text[] NOT NULL,
	"weighted_score" double precision,
	"red_flag_penalty" double precision,
	"system_score" double precision,
	"system_disposition" text,
	"red_flags" text[],
	"positive_signals" text[],
	"client_problem" text,
	"why_candidate_matches" text[],
	"missing_information" text[],
	"recommended_positioning" text,
	"client_summary" text,
	"analysis_summary" text,
	"extraction_model" text NOT NULL,
	"extraction_provider" text,
	"extraction_fallback_used" boolean NOT NULL,
	"analysis_model" text,
	"analysis_provider" text,
	"analysis_fallback_used" boolean,
	"completed_at" timestamp with time zone NOT NULL,
	"raw_result" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "job_analyses_workflow_run_unique" UNIQUE("workflow_run_id"),
	CONSTRAINT "job_analyses_id_job_unique" UNIQUE("id","job_id"),
	CONSTRAINT "job_analyses_extraction_check" CHECK (case "job_analyses"."extraction_status"
        when 'ok' then "job_analyses"."facts" is not null and "job_analyses"."extraction_error" is null
        when 'failed' then "job_analyses"."facts" is null and "job_analyses"."extraction_error" is not null
        else false
      end),
	CONSTRAINT "job_analyses_hard_filter_check" CHECK ("job_analyses"."hard_filter_pass" = (cardinality("job_analyses"."hard_filter_reasons") = 0)),
	CONSTRAINT "job_analyses_analysis_check" CHECK (case when "job_analyses"."hard_filter_pass" then
          "job_analyses"."system_score" is not null and "job_analyses"."system_disposition" is not null
          and "job_analyses"."weighted_score" is not null and "job_analyses"."red_flag_penalty" is not null
          and "job_analyses"."analysis_model" is not null and "job_analyses"."analysis_fallback_used" is not null
          and "job_analyses"."analysis_summary" is not null
        else
          "job_analyses"."system_score" is null and "job_analyses"."system_disposition" is null
          and "job_analyses"."weighted_score" is null and "job_analyses"."analysis_model" is null
        end),
	CONSTRAINT "job_analyses_system_disposition_check" CHECK ("job_analyses"."system_disposition" is null or "job_analyses"."system_disposition" in ('PRIORITY', 'REVIEW', 'LOW')),
	CONSTRAINT "job_analyses_system_score_check" CHECK ("job_analyses"."system_score" is null or ("job_analyses"."system_score" >= 1 and "job_analyses"."system_score" <= 10))
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workflow_run_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	CONSTRAINT "job_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "job_events_type_check" CHECK ("job_events"."type" in ('JOB_CREATED', 'LISTING_ADDED', 'ANALYSIS_STARTED', 'ANALYZED', 'DECLINED', 'ANALYSIS_OVERRIDE')),
	CONSTRAINT "job_events_actor_check" CHECK ("job_events"."actor" in ('owner', 'system', 'n8n')),
	CONSTRAINT "job_events_stage_check" CHECK (("job_events"."from_stage" is null or "job_events"."from_stage" in ('discovered', 'screened_out', 'dismissed', 'reviewing', 'declined', 'drafting', 'submitted', 'responded', 'interviewing', 'won', 'lost', 'withdrawn'))
        and ("job_events"."to_stage" is null or "job_events"."to_stage" in ('discovered', 'screened_out', 'dismissed', 'reviewing', 'declined', 'drafting', 'submitted', 'responded', 'interviewing', 'won', 'lost', 'withdrawn')))
);
--> statement-breakpoint
CREATE TABLE "job_listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"text_hash" text NOT NULL,
	"source_url" text,
	"char_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "job_listings_id_job_unique" UNIQUE("id","job_id"),
	CONSTRAINT "job_listings_text_hash_check" CHECK ("job_listings"."text_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "job_listings_char_count_check" CHECK ("job_listings"."char_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upwork_ref" text,
	"fingerprint" text,
	"title" text NOT NULL,
	"url" text,
	"origin" text NOT NULL,
	"stage" text NOT NULL,
	"close_reason" text,
	"current_analysis_id" uuid,
	"manual_score" double precision,
	"manual_disposition" text,
	"override_reason" text,
	"dismiss_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "jobs_origin_check" CHECK ("jobs"."origin" in ('manual_paste', 'email_alert')),
	CONSTRAINT "jobs_stage_check" CHECK ("jobs"."stage" in ('discovered', 'screened_out', 'dismissed', 'reviewing', 'declined', 'drafting', 'submitted', 'responded', 'interviewing', 'won', 'lost', 'withdrawn')),
	CONSTRAINT "jobs_manual_disposition_check" CHECK ("jobs"."manual_disposition" is null or "jobs"."manual_disposition" in ('PRIORITY', 'REVIEW', 'LOW')),
	CONSTRAINT "jobs_manual_score_check" CHECK ("jobs"."manual_score" is null or ("jobs"."manual_score" >= 1 and "jobs"."manual_score" <= 10)),
	CONSTRAINT "jobs_title_check" CHECK (length(btrim("jobs"."title")) between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "analysis_scores" ADD CONSTRAINT "analysis_scores_analysis_id_job_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."job_analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_config_snapshot_id_config_snapshots_id_fk" FOREIGN KEY ("config_snapshot_id") REFERENCES "public"."config_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_listing_fk" FOREIGN KEY ("listing_id","job_id") REFERENCES "public"."job_listings"("id","job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_listings" ADD CONSTRAINT "job_listings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_current_analysis_fk" FOREIGN KEY ("current_analysis_id","id") REFERENCES "public"."job_analyses"("id","job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_analyses_job_created_idx" ON "job_analyses" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "job_events_job_occurred_idx" ON "job_events" USING btree ("job_id","occurred_at");--> statement-breakpoint
CREATE INDEX "job_listings_job_created_idx" ON "job_listings" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_upwork_ref_unique" ON "jobs" USING btree ("upwork_ref") WHERE "jobs"."upwork_ref" is not null;--> statement-breakpoint
CREATE INDEX "jobs_updated_at_idx" ON "jobs" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runs_job_idx" ON "workflow_runs" USING btree ("job_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_active_job_contract_unique" ON "workflow_runs" USING btree ("job_id","contract") WHERE "workflow_runs"."status" in ('queued', 'running') and "workflow_runs"."job_id" is not null;