import { createHash } from 'node:crypto';

import type { AnalyzeRequest, GenerateProposalRequest } from '@/contracts';

// workflow_runs.request stores a sanitized summary, never the callback token, the callback
// URL, the full listing, analysis prose, base proposal body, or owner instructions.

export interface AnalyzeRequestSummary {
  job_id: string;
  upwork_ref: string | null;
  source_url: string | null;
  listing_id: string;
  listing_chars: number;
  listing_sha256: string;
}

export interface GenerateProposalRequestSummary {
  job_id: string;
  listing_id: string;
  listing_chars: number;
  analysis_id: string | null;
  base_version_number: number | null;
  has_instructions: boolean;
}

export type RequestSummary = AnalyzeRequestSummary | GenerateProposalRequestSummary;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export function summarizeAnalyzeRequest(request: AnalyzeRequest): AnalyzeRequestSummary {
  return {
    job_id: request.job.id,
    upwork_ref: request.job.upwork_ref,
    source_url: request.job.source_url,
    listing_id: request.input.listing_id,
    listing_chars: request.input.listing_text.length,
    listing_sha256: sha256(request.input.listing_text)
  };
}

export function summarizeGenerateProposalRequest(
  request: GenerateProposalRequest
): GenerateProposalRequestSummary {
  return {
    job_id: request.job.id,
    listing_id: request.listing.id,
    listing_chars: request.listing.text.length,
    analysis_id: request.analysis?.id ?? null,
    base_version_number: request.base_version?.number ?? null,
    has_instructions: request.instructions !== null
  };
}
