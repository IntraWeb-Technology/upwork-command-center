import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Disposition, JobStage } from '../api/types';
import { DISPOSITION_LABELS, STAGE_LABELS } from '../constants/job-options';

const CLOSED_STAGES = new Set<JobStage>([
  'screened_out',
  'dismissed',
  'declined',
  'lost',
  'withdrawn'
]);

export function StageBadge({ stage }: { stage: JobStage }) {
  return (
    <Badge variant={CLOSED_STAGES.has(stage) ? 'secondary' : 'outline'}>
      {STAGE_LABELS[stage]}
    </Badge>
  );
}

const DISPOSITION_CLASSES: Record<Disposition, string> = {
  PRIORITY: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  REVIEW: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  LOW: 'border-border bg-muted text-muted-foreground'
};

export function DispositionBadge({
  disposition,
  className
}: {
  disposition: Disposition;
  className?: string;
}) {
  return (
    <Badge variant='outline' className={cn(DISPOSITION_CLASSES[disposition], className)}>
      {DISPOSITION_LABELS[disposition]}
    </Badge>
  );
}
