'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AnalysisView, OverrideView } from '../../api/types';
import { useCountUp } from '../../hooks/use-count-up';
import { DispositionBadge } from '../job-badges';

interface ScoreCardProps {
  analysis: AnalysisView;
  override: OverrideView;
  onEditOverride?: () => void;
}

function AnimatedScore({ score }: { score: number }) {
  const value = useCountUp(score);
  return (
    <>
      <span className='sr-only'>{score.toFixed(1)} out of 10</span>
      <span aria-hidden className='text-5xl font-semibold tracking-tight tabular-nums'>
        {value.toFixed(1)}
      </span>
      <span aria-hidden className='text-muted-foreground text-lg'>
        /10
      </span>
    </>
  );
}

export function ScoreCard({ analysis, override, onEditOverride }: ScoreCardProps) {
  const hasOverride = override.manual_score !== null || override.manual_disposition !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>System score</CardTitle>
        <CardDescription>Weighted from seven dimensions, minus red flag penalties.</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex flex-wrap items-end justify-between gap-4'>
          <div className='flex items-baseline gap-1'>
            {analysis.system_score !== null ? (
              <AnimatedScore key={analysis.id} score={analysis.system_score} />
            ) : (
              <span className='text-muted-foreground text-2xl'>Not scored</span>
            )}
          </div>
          {analysis.system_disposition ? (
            <DispositionBadge
              disposition={analysis.system_disposition}
              className='h-6 px-3 text-sm'
            />
          ) : null}
        </div>

        {analysis.weighted_score !== null ? (
          <dl className='text-muted-foreground grid grid-cols-2 gap-2 text-sm'>
            <div>
              <dt>Weighted score</dt>
              <dd className='text-foreground tabular-nums'>{analysis.weighted_score.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Red flag penalty</dt>
              <dd className='text-foreground tabular-nums'>
                {(analysis.red_flag_penalty ?? 0).toFixed(2)}
              </dd>
            </div>
          </dl>
        ) : null}

        <div className='bg-muted/50 rounded-lg border p-3 text-sm'>
          <div className='flex items-start justify-between gap-3'>
            <div className='space-y-1'>
              <p className='font-medium'>Owner override</p>
              {hasOverride ? (
                <div className='space-y-1'>
                  <p>
                    Score:{' '}
                    <span className='tabular-nums'>
                      {override.manual_score !== null
                        ? override.manual_score.toFixed(1)
                        : 'System value'}
                    </span>
                  </p>
                  <p className='flex items-center gap-2'>
                    Disposition:{' '}
                    {override.manual_disposition ? (
                      <DispositionBadge disposition={override.manual_disposition} />
                    ) : (
                      'System value'
                    )}
                  </p>
                  {override.reason ? (
                    <p className='text-muted-foreground'>Reason: {override.reason}</p>
                  ) : null}
                </div>
              ) : (
                <p className='text-muted-foreground'>None. The system values apply.</p>
              )}
            </div>
            {onEditOverride ? (
              <Button variant='outline' size='sm' onClick={onEditOverride}>
                <Icons.edit aria-hidden /> {hasOverride ? 'Edit' : 'Override'}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
