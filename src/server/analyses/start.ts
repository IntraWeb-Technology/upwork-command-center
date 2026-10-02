import 'server-only';

import { appendJobEvent } from '@/server/jobs/events';
import { JobDomainError } from '@/server/jobs/errors';
import { ANALYZABLE_STAGES, getCurrentListing, getJobRow } from '@/server/jobs/repository';
import { getEffectiveStatus } from '@/server/runs/effective-status';
import {
  dispatchWorkflowRun,
  type DispatchDeps,
  type DispatchResult
} from '@/server/runs/dispatch';
import { failWorkflowRun, getActiveJobRun, RunStateError } from '@/server/runs/repository';

const CONTRACT = 'ujh.analyze.v1';

/**
 * Starts a ujh.analyze.v1 run for the job's current listing. A previous run that is still
 * active blocks a new one unless it is past its deadline, in which case it is failed with
 * TIMEOUT first (a late callback for it is then ignored as a duplicate).
 */
export async function startAnalysis(deps: DispatchDeps, jobId: string): Promise<DispatchResult> {
  const now = deps.now?.() ?? new Date();
  const job = await getJobRow(deps.db, jobId);
  if (!job) throw new JobDomainError('NOT_FOUND', 'Job not found.');
  if (!ANALYZABLE_STAGES.includes(job.stage)) {
    throw new JobDomainError('INVALID_STAGE', `A job in stage "${job.stage}" cannot be analyzed.`);
  }
  const listing = await getCurrentListing(deps.db, jobId);
  if (!listing) throw new JobDomainError('NO_LISTING', 'The job has no listing to analyze.');

  const active = await getActiveJobRun(deps.db, jobId, CONTRACT);
  if (active) {
    if (getEffectiveStatus(active, now) !== 'timed_out') {
      throw new JobDomainError('ACTIVE_RUN', 'An analysis is already running for this job.', {
        jobId,
        runId: active.id
      });
    }
    await failWorkflowRun(
      deps.db,
      active.id,
      {
        code: 'TIMEOUT',
        stage: null,
        message: 'No result was received before the deadline.',
        retryable: true
      },
      now
    );
  }

  try {
    return await dispatchWorkflowRun(
      deps,
      {
        contract: CONTRACT,
        payload: {
          job: { id: job.id, upwork_ref: job.upworkRef, source_url: job.url },
          input: { listing_id: listing.id, listing_text: listing.rawText }
        }
      },
      {
        jobId,
        onCreated: (tx, run) =>
          appendJobEvent(tx, {
            jobId,
            type: 'ANALYSIS_STARTED',
            actor: 'owner',
            occurredAt: now,
            workflowRunId: run.id,
            payload: { listing_id: listing.id }
          })
      }
    );
  } catch (error) {
    if (error instanceof RunStateError && error.code === 'CONFLICT') {
      throw new JobDomainError('ACTIVE_RUN', 'An analysis is already running for this job.', {
        jobId
      });
    }
    throw error;
  }
}
