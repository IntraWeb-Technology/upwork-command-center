import analyzeFailed from '../../../contracts/fixtures/analyze/valid/callback.failed.json';
import analyzeHardFiltered from '../../../contracts/fixtures/analyze/valid/callback.succeeded-hard-filtered.json';
import analyzeSucceeded from '../../../contracts/fixtures/analyze/valid/callback.succeeded.json';
import proposalFailed from '../../../contracts/fixtures/generate_proposal/valid/callback.failed.json';
import proposalSucceeded from '../../../contracts/fixtures/generate_proposal/valid/callback.succeeded.json';

import type { DispatchOutcome, DispatchRequest, N8nTransport } from './transport';

/**
 * ack: accepted, no callback until a test delivers one.
 * callback_before_ack: the success callback is delivered before the acknowledgement returns.
 * success / failure: accepted, then the matching callback is queued for flush().
 * success_hard_filtered: like success, but the analyze callback reports a hard-filter rejection.
 * reject: explicit INVALID_INPUT rejection. unavailable: UPSTREAM_UNAVAILABLE rejection.
 * ambiguous: the outcome is unknown (for example an acknowledgement timeout).
 */
export type FakeScenario =
  | 'ack'
  | 'callback_before_ack'
  | 'success'
  | 'success_hard_filtered'
  | 'failure'
  | 'reject'
  | 'unavailable'
  | 'ambiguous';

export type DeliverCallback = (payload: Record<string, unknown>) => Promise<void>;

export interface FakeTransport extends N8nTransport {
  readonly requests: readonly DispatchRequest[];
  setScenario(scenario: FakeScenario): void;
  /** Delivers queued callbacks in order. */
  flush(): Promise<void>;
}

export type FakeCallbackKind = 'succeeded' | 'succeeded_hard_filtered' | 'failed';

const FIXTURES = {
  'ujh.analyze.v1': {
    succeeded: analyzeSucceeded,
    succeeded_hard_filtered: analyzeHardFiltered,
    failed: analyzeFailed
  },
  'ujh.generate_proposal.v1': {
    succeeded: proposalSucceeded,
    succeeded_hard_filtered: proposalSucceeded,
    failed: proposalFailed
  }
} as const;

/** A contract-valid callback for the request, built from the committed fixtures. */
export function buildFakeCallback(
  request: DispatchRequest,
  kind: FakeCallbackKind,
  completedAt: Date = new Date()
): Record<string, unknown> {
  return {
    ...structuredClone(FIXTURES[request.contract][kind]),
    contract: request.contract,
    run_id: request.run_id,
    callback_token: request.callback.token,
    completed_at: completedAt.toISOString(),
    execution_ref: `fake-${request.run_id.slice(0, 8)}`
  };
}

export function createFakeTransport(options: {
  scenario: FakeScenario;
  deliver: DeliverCallback;
}): FakeTransport {
  let scenario = options.scenario;
  const requests: DispatchRequest[] = [];
  const queue: Array<Record<string, unknown>> = [];

  return {
    requests,
    setScenario(next) {
      scenario = next;
    },
    async flush() {
      while (queue.length > 0) {
        const payload = queue.shift();
        if (payload) await options.deliver(payload);
      }
    },
    async dispatch(request): Promise<DispatchOutcome> {
      requests.push(request);
      const accepted: DispatchOutcome = {
        type: 'accepted',
        executionRef: `fake-${request.run_id.slice(0, 8)}`
      };
      switch (scenario) {
        case 'ack':
          return accepted;
        case 'callback_before_ack':
          await options.deliver(buildFakeCallback(request, 'succeeded'));
          return accepted;
        case 'success':
          queue.push(buildFakeCallback(request, 'succeeded'));
          return accepted;
        case 'success_hard_filtered':
          queue.push(buildFakeCallback(request, 'succeeded_hard_filtered'));
          return accepted;
        case 'failure':
          queue.push(buildFakeCallback(request, 'failed'));
          return accepted;
        case 'reject':
          return {
            type: 'rejected',
            code: 'INVALID_INPUT',
            message: 'Fake n8n rejected the input'
          };
        case 'unavailable':
          return {
            type: 'rejected',
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'Fake n8n is unavailable'
          };
        case 'ambiguous':
          return { type: 'ambiguous', reason: 'timeout' };
      }
    }
  };
}
