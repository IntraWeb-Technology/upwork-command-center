import type { AnalyzeRequest, GenerateProposalRequest } from '@/contracts';

export type DispatchRequest = AnalyzeRequest | GenerateProposalRequest;

/**
 * accepted: n8n acknowledged the run and will call back.
 * rejected: n8n definitively did not start the run; it is safe to fail it.
 * ambiguous: n8n may or may not be processing it; the run stays queued until a callback
 * arrives or the deadline passes.
 */
export type DispatchOutcome =
  | { type: 'accepted'; executionRef: string | null }
  | { type: 'rejected'; code: 'INVALID_INPUT' | 'UPSTREAM_UNAVAILABLE'; message: string }
  | { type: 'ambiguous'; reason: string };

export interface N8nTransport {
  dispatch(request: DispatchRequest): Promise<DispatchOutcome>;
}
