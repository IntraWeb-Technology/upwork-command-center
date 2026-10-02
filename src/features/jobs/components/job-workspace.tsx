'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { startAnalysisMutation } from '../api/mutations';
import { isRunActive, jobByIdOptions } from '../api/queries';
import { JobsApiError } from '../api/service';
import { useLatestRun } from '../hooks/use-latest-run';
import { AnalysisPanel } from './analysis/analysis-panel';
import { DateTime } from './date-time';
import { DeclineDialog } from './decline-dialog';
import { DispositionBadge, StageBadge } from './job-badges';
import { ListingPanel } from './listing-panel';
import { OverrideDialog } from './override-dialog';
import { TimelinePanel } from './timeline-panel';

const TABS = ['listing', 'analysis', 'timeline'] as const;

export function JobWorkspace({ jobId }: { jobId: string }) {
  const { data: job } = useSuspenseQuery(jobByIdOptions(jobId));
  const run = useLatestRun(job);
  const [tab, setTab] = useQueryState('tab', parseAsStringLiteral(TABS).withDefault('analysis'));
  const [declineOpen, setDeclineOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const analyze = useMutation({
    ...startAnalysisMutation,
    onSuccess: () => {
      void setTab('analysis');
    },
    onError: (error) => {
      if (error instanceof JobsApiError && error.code === 'ACTIVE_RUN') {
        toast.info('An analysis is already running for this job.');
        return;
      }
      if (error instanceof JobsApiError && error.code === 'ANALYSIS_UNAVAILABLE') {
        toast.error('Analysis is not available right now.');
        return;
      }
      toast.error("Couldn't start the analysis. Try again.");
    }
  });

  const running = run !== null && isRunActive(run.effective_status);
  const canStart = job.can_analyze && job.listing !== null && !running;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-sm'>
          <StageBadge stage={job.stage} />
          {job.final_disposition ? <DispositionBadge disposition={job.final_disposition} /> : null}
          <span>
            Added <DateTime value={job.created_at} />
          </span>
          {job.url ? (
            <a
              href={job.url}
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline'
            >
              Open on Upwork <Icons.externalLink className='size-3.5' aria-hidden />
              <span className='sr-only'>(opens in a new tab)</span>
            </a>
          ) : null}
        </div>
        <div className='flex flex-wrap gap-2'>
          {job.can_decline ? (
            <Button variant='outline' onClick={() => setDeclineOpen(true)}>
              <Icons.ban aria-hidden /> Decline
            </Button>
          ) : null}
          {job.analysis && canStart ? (
            <LoadingButton
              variant='outline'
              loading={analyze.isPending}
              loadingLabel='Starting analysis.'
              onClick={() => analyze.mutate(job.id)}
            >
              <Icons.refresh aria-hidden /> Analyze Again
            </LoadingButton>
          ) : null}
        </div>
      </div>

      {job.stage === 'declined' && job.close_reason ? (
        <p className='text-muted-foreground text-sm'>Declined: {job.close_reason}</p>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => void setTab(value as (typeof TABS)[number])}>
        <TabsList>
          <TabsTrigger value='listing'>Listing</TabsTrigger>
          <TabsTrigger value='analysis'>
            Analysis
            {running ? (
              <span className='bg-primary size-1.5 animate-pulse rounded-full motion-reduce:animate-none' />
            ) : null}
          </TabsTrigger>
          <TabsTrigger value='timeline'>Timeline</TabsTrigger>
          <TabsTrigger value='proposal' disabled>
            Proposal
          </TabsTrigger>
        </TabsList>
        <TabsContent value='listing' className='pt-2'>
          <ListingPanel listing={job.listing} />
        </TabsContent>
        <TabsContent value='analysis' className='pt-2'>
          <AnalysisPanel
            job={job}
            run={run}
            onAnalyze={() => analyze.mutate(job.id)}
            isStarting={analyze.isPending}
            onEditOverride={() => setOverrideOpen(true)}
          />
        </TabsContent>
        <TabsContent value='timeline' className='pt-2'>
          <TimelinePanel entries={job.timeline} />
        </TabsContent>
      </Tabs>

      <DeclineDialog jobId={job.id} open={declineOpen} onOpenChange={setDeclineOpen} />
      {job.analysis ? (
        <OverrideDialog job={job} open={overrideOpen} onOpenChange={setOverrideOpen} />
      ) : null}
    </div>
  );
}
