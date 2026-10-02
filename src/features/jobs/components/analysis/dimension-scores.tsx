import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DimensionScoreView } from '../../api/types';
import { DIMENSION_LABELS } from '../../constants/job-options';

export function DimensionScores({ scores }: { scores: DimensionScoreView[] }) {
  if (scores.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dimensions</CardTitle>
        <CardDescription>
          Each score is out of 10. Weights show its share of the total.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='space-y-5'>
          {scores.map((item) => {
            const label = DIMENSION_LABELS[item.dimension];
            return (
              <li key={item.dimension} className='space-y-1.5'>
                <div className='flex items-baseline justify-between gap-3 text-sm'>
                  <span className='font-medium'>{label}</span>
                  <span className='text-muted-foreground tabular-nums'>
                    <span className='text-foreground font-medium'>{item.score.toFixed(1)}</span>
                    /10 · weight {Math.round(item.weight * 100)}%
                  </span>
                </div>
                <div
                  role='meter'
                  aria-label={`${label} score`}
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-valuenow={item.score}
                  className='bg-muted h-2 overflow-hidden rounded-full'
                >
                  <div
                    className='bg-primary h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none'
                    style={{ width: `${Math.max(0, Math.min(100, item.score * 10))}%` }}
                  />
                </div>
                {item.evidence ? (
                  <p className='text-muted-foreground text-sm'>{item.evidence}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
