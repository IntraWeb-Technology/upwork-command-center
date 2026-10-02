'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { LoadingButton } from '@/components/ui/loading-button';
import { Skeleton } from '@/components/ui/skeleton';
import { isRunActive } from '../../api/queries';
import type { AnalysisView, JobDetail, WorkflowRunView } from '../../api/types';
import { DateTime } from '../date-time';
import { FactsCard, SignalList, TextSection } from './analysis-details';
import { DimensionScores } from './dimension-scores';
import { ScoreCard } from './score-card';

interface AnalysisPanelProps {
  job: JobDetail;
  run: WorkflowRunView | null;
  onAnalyze: () => void;
  isStarting: boolean;
  onEditOverride: () => void;
}

export function AnalysisPanel({
  job,
  run,
  onAnalyze,
  isStarting,
  onEditOverride
}: AnalysisPanelProps) {
  const running = run !== null && isRunActive(run.effective_status);
  const runFailed =
    run !== null &&
    (run.effective_status === 'failed' || run.effective_status === 'timed_out') &&
    (job.analysis === null || run.requested_at > job.analysis.created_at);

  return (
    <div className='space-y-4'>
      {running ? <RunningState /> : null}
      {runFailed && run ? (
        <RunFailedState
          run={run}
          canRetry={job.can_analyze}
          onAnalyze={onAnalyze}
          isStarting={isStarting}
        />
      ) : null}
      {job.analysis ? (
        <AnalysisContent
          analysis={job.analysis}
          job={job}
          dimmed={running}
          onEditOverride={onEditOverride}
        />
      ) : !running && !runFailed ? (
        <NoAnalysis
          canAnalyze={job.can_analyze && job.listing !== null}
          onAnalyze={onAnalyze}
          isStarting={isStarting}
        />
      ) : null}
    </div>
  );
}

function RunningState() {
  return (
    <div role='status' aria-live='polite' className='space-y-4 rounded-xl border p-4'>
      <div className='flex items-center gap-3'>
        <span className='relative flex size-3'>
          <span className='bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none' />
          <span className='bg-primary relative inline-flex size-3 rounded-full' />
        </span>
        <div>
          <p className='font-medium'>Analyzing job...</p>
          <p className='text-muted-foreground text-sm'>Extracting and scoring the listing.</p>
        </div>
      </div>
      <div className='grid gap-3 md:grid-cols-2' aria-hidden>
        <Skeleton className='h-28' />
        <Skeleton className='h-28' />
        <Skeleton className='h-4 w-2/3' />
        <Skeleton className='h-4 w-1/2' />
      </div>
    </div>
  );
}

function RunFailedState({
  run,
  canRetry,
  onAnalyze,
  isStarting
}: {
  run: WorkflowRunView;
  canRetry: boolean;
  onAnalyze: () => void;
  isStarting: boolean;
}) {
  const timedOut = run.effective_status === 'timed_out';
  return (
    <Alert variant='destructive'>
      <Icons.alertCircle aria-hidden />
      <AlertTitle>{timedOut ? 'Analysis timed out' : 'Analysis failed'}</AlertTitle>
      <AlertDescription>
        <p>
          {timedOut
            ? 'No result arrived before the deadline. Any late result will be ignored.'
            : (run.error?.message ?? 'The analysis could not be completed.')}
        </p>
        {canRetry ? (
          <LoadingButton
            variant='outline'
            size='sm'
            className='mt-3'
            loading={isStarting}
            loadingLabel='Starting analysis.'
            onClick={onAnalyze}
          >
            <Icons.refresh aria-hidden /> Analyze Again
          </LoadingButton>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function NoAnalysis({
  canAnalyze,
  onAnalyze,
  isStarting
}: {
  canAnalyze: boolean;
  onAnalyze: () => void;
  isStarting: boolean;
}) {
  return (
    <Empty className='border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icons.sparkles />
        </EmptyMedia>
        <EmptyTitle>No analysis yet</EmptyTitle>
        <EmptyDescription>
          {canAnalyze
            ? 'Run an analysis to score this listing.'
            : 'This job cannot be analyzed in its current stage.'}
        </EmptyDescription>
      </EmptyHeader>
      {canAnalyze ? (
        <EmptyContent>
          <LoadingButton loading={isStarting} loadingLabel='Starting analysis.' onClick={onAnalyze}>
            <Icons.sparkles aria-hidden /> Analyze Job
          </LoadingButton>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

function AnalysisContent({
  analysis,
  job,
  dimmed,
  onEditOverride
}: {
  analysis: AnalysisView;
  job: JobDetail;
  dimmed: boolean;
  onEditOverride: () => void;
}) {
  const facts = analysis.extraction.facts;

  return (
    <div className={dimmed ? 'space-y-4 opacity-60' : 'space-y-4'}>
      <p className='text-muted-foreground text-sm'>
        {dimmed ? 'Previous analysis, ' : 'Analyzed '}
        <DateTime value={analysis.completed_at} />
      </p>

      {!analysis.for_current_listing ? (
        <Alert>
          <Icons.info aria-hidden />
          <AlertTitle>Earlier listing snapshot</AlertTitle>
          <AlertDescription>
            This analysis refers to an earlier version of the listing. Analyze again to score the
            current text.
          </AlertDescription>
        </Alert>
      ) : null}

      {analysis.extraction.status === 'failed' ? (
        <Alert variant='destructive'>
          <Icons.warning aria-hidden />
          <AlertTitle>Extraction failed</AlertTitle>
          <AlertDescription>
            {analysis.extraction.error ?? 'Facts could not be extracted from the listing.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {!analysis.hard_filter.pass ? (
        <Alert variant='destructive'>
          <Icons.ban aria-hidden />
          <AlertTitle>Hard filter failed</AlertTitle>
          <AlertDescription>
            <ul className='list-disc space-y-0.5 pl-5'>
              {analysis.hard_filter.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className='mt-2'>The job was not scored. Decide yourself whether to decline it.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {analysis.hard_filter.pass ? (
        <div className='grid gap-4 lg:grid-cols-2'>
          <ScoreCard analysis={analysis} override={job.override} onEditOverride={onEditOverride} />
          <DimensionScores scores={analysis.scores} />
        </div>
      ) : null}

      <div className='grid gap-4 lg:grid-cols-2'>
        <TextSection title='Analysis summary' text={analysis.analysis_summary} />
        <TextSection title='Client problem' text={analysis.client_problem} />
        <TextSection title='Recommended positioning' text={analysis.recommended_positioning} />
        <TextSection title='Client summary' text={analysis.client_summary} />
      </div>

      {analysis.hard_filter.pass ? (
        <div className='grid gap-4 lg:grid-cols-2'>
          <SignalList
            title='Positive signals'
            items={analysis.positive_signals}
            empty='None found.'
            tone='positive'
          />
          <SignalList
            title='Red flags'
            items={analysis.red_flags}
            empty='None found.'
            tone='negative'
          />
          <SignalList
            title='Why the candidate matches'
            items={analysis.why_candidate_matches}
            empty='No specific match points.'
          />
          <SignalList
            title='Missing information'
            items={analysis.missing_information}
            empty='Nothing important is missing.'
          />
        </div>
      ) : null}

      {facts ? <FactsCard facts={facts} /> : null}
    </div>
  );
}
