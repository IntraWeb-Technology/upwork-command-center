import type { Disposition, JobStage, ScoreDimension } from '../api/types';

export const STAGE_LABELS: Record<JobStage, string> = {
  discovered: 'Discovered',
  screened_out: 'Screened out',
  dismissed: 'Dismissed',
  reviewing: 'Reviewing',
  declined: 'Declined',
  drafting: 'Drafting',
  submitted: 'Submitted',
  responded: 'Responded',
  interviewing: 'Interviewing',
  won: 'Won',
  lost: 'Lost',
  withdrawn: 'Withdrawn'
};

export const STAGE_OPTIONS = (Object.keys(STAGE_LABELS) as JobStage[]).map((value) => ({
  value,
  label: STAGE_LABELS[value]
}));

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  PRIORITY: 'Priority',
  REVIEW: 'Review',
  LOW: 'Low'
};

export const DISPOSITION_OPTIONS = (Object.keys(DISPOSITION_LABELS) as Disposition[]).map(
  (value) => ({ value, label: DISPOSITION_LABELS[value] })
);

export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  technical_fit: 'Technical fit',
  budget_score: 'Budget',
  client_quality: 'Client quality',
  long_term_potential: 'Long-term potential',
  communication_quality: 'Communication quality',
  competition_score: 'Competition',
  strategic_fit: 'Strategic fit'
};

export const MAX_LISTING_CHARS = 100000;
