import { Icons } from '@/components/icons';
import type { JobEventType, TimelineEntry } from '../api/types';
import { STAGE_LABELS } from '../constants/job-options';
import { DateTime } from './date-time';

const EVENT_LABELS: Record<JobEventType, string> = {
  JOB_CREATED: 'Job created',
  LISTING_ADDED: 'Listing snapshot saved',
  ANALYSIS_STARTED: 'Analysis started',
  ANALYZED: 'Analysis completed',
  DECLINED: 'Declined',
  ANALYSIS_OVERRIDE: 'Override updated'
};

const EVENT_ICONS: Record<JobEventType, keyof typeof Icons> = {
  JOB_CREATED: 'add',
  LISTING_ADDED: 'page',
  ANALYSIS_STARTED: 'clock',
  ANALYZED: 'sparkles',
  DECLINED: 'ban',
  ANALYSIS_OVERRIDE: 'edit'
};

const ACTOR_LABELS: Record<TimelineEntry['actor'], string> = {
  owner: 'You',
  system: 'System',
  n8n: 'Automation'
};

export function TimelinePanel({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className='text-muted-foreground text-sm'>No events yet.</p>;
  }

  return (
    <ol className='relative space-y-6 border-l pl-6'>
      {entries.map((entry) => {
        const Icon = Icons[EVENT_ICONS[entry.type]];
        return (
          <li key={entry.id} className='relative'>
            <span className='bg-background absolute top-0.5 -left-[2.0625rem] flex size-6 items-center justify-center rounded-full border'>
              <Icon className='size-3.5' aria-hidden />
            </span>
            <div className='flex flex-wrap items-baseline justify-between gap-x-3'>
              <p className='font-medium'>{EVENT_LABELS[entry.type]}</p>
              <DateTime value={entry.occurred_at} className='text-muted-foreground text-xs' />
            </div>
            <p className='text-muted-foreground text-sm'>
              {ACTOR_LABELS[entry.actor]}
              {entry.from_stage && entry.to_stage && entry.from_stage !== entry.to_stage
                ? ` · ${STAGE_LABELS[entry.from_stage]} to ${STAGE_LABELS[entry.to_stage]}`
                : ''}
            </p>
            {entry.detail ? <p className='mt-1 text-sm'>{entry.detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
