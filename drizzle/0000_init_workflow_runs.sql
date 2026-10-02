CREATE TYPE "public"."workflow_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract" text NOT NULL,
	"status" "workflow_run_status" DEFAULT 'queued' NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_stage" text,
	"error_message" text,
	"retryable" boolean,
	"callback_token_hash" text NOT NULL,
	"n8n_execution_ref" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"retry_of_run_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_runs_contract_check" CHECK ("workflow_runs"."contract" in ('ujh.analyze.v1', 'ujh.generate_proposal.v1')),
	CONSTRAINT "workflow_runs_callback_token_hash_check" CHECK ("workflow_runs"."callback_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workflow_runs_deadline_check" CHECK ("workflow_runs"."deadline_at" > "workflow_runs"."requested_at"),
	CONSTRAINT "workflow_runs_attempt_check" CHECK ("workflow_runs"."attempt" >= 1 and ("workflow_runs"."attempt" = 1) = ("workflow_runs"."retry_of_run_id" is null)),
	CONSTRAINT "workflow_runs_error_code_check" CHECK ("workflow_runs"."error_code" is null or "workflow_runs"."error_code" in ('INVALID_INPUT', 'UPSTREAM_UNAVAILABLE', 'MODEL_ERROR', 'MODEL_OUTPUT_INVALID', 'TIMEOUT', 'INTERNAL')),
	CONSTRAINT "workflow_runs_outcome_check" CHECK (case "workflow_runs"."status"
        when 'succeeded' then "workflow_runs"."finished_at" is not null and "workflow_runs"."result" is not null and "workflow_runs"."error_code" is null
        when 'failed' then "workflow_runs"."finished_at" is not null and "workflow_runs"."result" is null and "workflow_runs"."error_code" is not null and "workflow_runs"."error_message" is not null and "workflow_runs"."retryable" is not null
        else "workflow_runs"."finished_at" is null and "workflow_runs"."result" is null and "workflow_runs"."error_code" is null
      end)
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_retry_of_run_id_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_retry_of_run_id_unique" ON "workflow_runs" USING btree ("retry_of_run_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_requested_at_idx" ON "workflow_runs" USING btree ("requested_at");