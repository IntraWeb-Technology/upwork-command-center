-- History tables are append-only: listing snapshots, analyses, scores, configuration
-- snapshots, and job events can be inserted but never updated or deleted.
CREATE FUNCTION "ucc_reject_history_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "job_listings_append_only" BEFORE UPDATE OR DELETE ON "job_listings"
  FOR EACH ROW EXECUTE FUNCTION "ucc_reject_history_change"();
--> statement-breakpoint
CREATE TRIGGER "job_analyses_append_only" BEFORE UPDATE OR DELETE ON "job_analyses"
  FOR EACH ROW EXECUTE FUNCTION "ucc_reject_history_change"();
--> statement-breakpoint
CREATE TRIGGER "analysis_scores_append_only" BEFORE UPDATE OR DELETE ON "analysis_scores"
  FOR EACH ROW EXECUTE FUNCTION "ucc_reject_history_change"();
--> statement-breakpoint
CREATE TRIGGER "config_snapshots_append_only" BEFORE UPDATE OR DELETE ON "config_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "ucc_reject_history_change"();
--> statement-breakpoint
CREATE TRIGGER "job_events_append_only" BEFORE UPDATE OR DELETE ON "job_events"
  FOR EACH ROW EXECUTE FUNCTION "ucc_reject_history_change"();
