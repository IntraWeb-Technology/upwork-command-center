// Response shapes of /api/jobs and /api/workflow-runs. Shared by the server read models
// (type-only imports) and the client service layer. Never raw database rows.

export type JobStage =
  | 'discovered'
  | 'screened_out'
  | 'dismissed'
  | 'reviewing'
  | 'declined'
  | 'drafting'
  | 'submitted'
  | 'responded'
  | 'interviewing'
  | 'won'
  | 'lost'
  | 'withdrawn';

export type Disposition = 'PRIORITY' | 'REVIEW' | 'LOW';

export type ScoreDimension =
  | 'technical_fit'
  | 'budget_score'
  | 'client_quality'
  | 'long_term_potential'
  | 'communication_quality'
  | 'competition_score'
  | 'strategic_fit';

export type EffectiveRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out';

export interface WorkflowRunView {
  id: string;
  contract: 'ujh.analyze.v1' | 'ujh.generate_proposal.v1';
  stored_status: 'queued' | 'running' | 'succeeded' | 'failed';
  effective_status: EffectiveRunStatus;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  deadline_at: string;
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface JobListItem {
  id: string;
  title: string;
  stage: JobStage;
  system_score: number | null;
  system_disposition: Disposition | null;
  hard_filter_pass: boolean | null;
  final_score: number | null;
  final_disposition: Disposition | null;
  has_override: boolean;
  analysis_status: EffectiveRunStatus | null;
  created_at: string;
  updated_at: string;
}

export interface JobListResponse {
  items: JobListItem[];
  total: number;
}

export interface JobFilters {
  page?: number;
  perPage?: number;
  search?: string;
  stage?: string;
  sort?: string;
}

export interface ListingView {
  id: string;
  text: string;
  char_count: number;
  source_url: string | null;
  created_at: string;
  snapshot_count: number;
}

export interface ExtractionFactsView {
  title: string | null;
  posted_at: string | null;
  budget_type: 'fixed' | 'hourly' | null;
  budget_min: number | null;
  budget_max: number | null;
  hourly_min: number | null;
  hourly_max: number | null;
  connect_cost: number | null;
  payment_verified: boolean | null;
  client_location: string | null;
  client_total_spend: number | null;
  client_hires: number | null;
  client_rating: number | null;
  proposal_count: string | null;
  skills: string[];
  job_category: string;
  excludes_us_freelancers: boolean | null;
  is_likely_scam: boolean;
  scam_signals: string[];
  listing_is_incomplete: boolean;
  summary: string;
}

export interface DimensionScoreView {
  dimension: ScoreDimension;
  score: number;
  weight: number;
  evidence: string | null;
}

export interface AnalysisView {
  id: string;
  created_at: string;
  completed_at: string;
  listing_id: string;
  for_current_listing: boolean;
  extraction: {
    status: 'ok' | 'failed';
    error: string | null;
    facts: ExtractionFactsView | null;
  };
  hard_filter: { pass: boolean; reasons: string[] };
  system_score: number | null;
  system_disposition: Disposition | null;
  weighted_score: number | null;
  red_flag_penalty: number | null;
  scores: DimensionScoreView[];
  red_flags: string[];
  positive_signals: string[];
  client_problem: string | null;
  why_candidate_matches: string[];
  missing_information: string[];
  recommended_positioning: string | null;
  client_summary: string | null;
  analysis_summary: string | null;
}

export interface AnalysisHistoryItem {
  id: string;
  created_at: string;
  system_score: number | null;
  system_disposition: Disposition | null;
  hard_filter_pass: boolean;
  is_current: boolean;
}

export interface OverrideView {
  manual_score: number | null;
  manual_disposition: Disposition | null;
  reason: string | null;
}

export type JobEventType =
  | 'JOB_CREATED'
  | 'LISTING_ADDED'
  | 'ANALYSIS_STARTED'
  | 'ANALYZED'
  | 'DECLINED'
  | 'ANALYSIS_OVERRIDE';

export interface TimelineEntry {
  id: string;
  type: JobEventType;
  actor: 'owner' | 'system' | 'n8n';
  from_stage: JobStage | null;
  to_stage: JobStage | null;
  occurred_at: string;
  detail: string | null;
}

export interface JobDetail {
  id: string;
  title: string;
  url: string | null;
  upwork_ref: string | null;
  origin: 'manual_paste' | 'email_alert';
  stage: JobStage;
  close_reason: string | null;
  created_at: string;
  updated_at: string;
  listing: ListingView | null;
  analysis: AnalysisView | null;
  analysis_history: AnalysisHistoryItem[];
  override: OverrideView;
  final_score: number | null;
  final_disposition: Disposition | null;
  latest_run: WorkflowRunView | null;
  can_analyze: boolean;
  can_decline: boolean;
  timeline: TimelineEntry[];
}

export interface CreateJobPayload {
  title: string;
  url?: string | null;
  listing_text: string;
  analyze?: boolean;
}

export interface CreateJobResponse {
  job: JobDetail;
  run: WorkflowRunView | null;
}

export interface StartAnalysisResponse {
  run: WorkflowRunView;
}

export interface DeclineJobPayload {
  to_stage: 'declined';
  reason: string;
}

export interface OverridePayload {
  manual_score: number | null;
  manual_disposition: Disposition | null;
  reason: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; job_id?: string; run_id?: string };
}
