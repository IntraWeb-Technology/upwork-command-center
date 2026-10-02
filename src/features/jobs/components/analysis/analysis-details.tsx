import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ExtractionFactsView } from '../../api/types';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

function formatRange(min: number | null, max: number | null, suffix = ''): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max) {
    return `${money.format(min)} to ${money.format(max)}${suffix}`;
  }
  return `${money.format((min ?? max) as number)}${suffix}`;
}

function formatBoolean(value: boolean | null): string | null {
  if (value === null) return null;
  return value ? 'Yes' : 'No';
}

export function FactsCard({ facts }: { facts: ExtractionFactsView }) {
  const budget =
    facts.budget_type === 'hourly'
      ? formatRange(facts.hourly_min, facts.hourly_max, '/hr')
      : formatRange(facts.budget_min, facts.budget_max);

  const rows: { label: string; value: string | null }[] = [
    {
      label: 'Budget',
      value: budget
        ? `${budget}${facts.budget_type ? ` (${facts.budget_type === 'hourly' ? 'hourly' : 'fixed'})` : ''}`
        : null
    },
    { label: 'Category', value: facts.job_category || null },
    { label: 'Proposals', value: facts.proposal_count },
    { label: 'Connects', value: facts.connect_cost !== null ? String(facts.connect_cost) : null },
    { label: 'Payment verified', value: formatBoolean(facts.payment_verified) },
    { label: 'Client location', value: facts.client_location },
    {
      label: 'Client spend',
      value: facts.client_total_spend !== null ? money.format(facts.client_total_spend) : null
    },
    {
      label: 'Client hires',
      value: facts.client_hires !== null ? String(facts.client_hires) : null
    },
    {
      label: 'Client rating',
      value: facts.client_rating !== null ? facts.client_rating.toFixed(1) : null
    },
    { label: 'Excludes US freelancers', value: formatBoolean(facts.excludes_us_freelancers) },
    { label: 'Posted', value: facts.posted_at }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Facts</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <dl className='grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2'>
          {rows.map((row) => (
            <div
              key={row.label}
              className='flex justify-between gap-3 border-b pb-2 sm:block sm:border-0 sm:pb-0'
            >
              <dt className='text-muted-foreground'>{row.label}</dt>
              <dd className={cn(row.value === null && 'text-muted-foreground')}>
                {row.value ?? 'Not stated'}
              </dd>
            </div>
          ))}
        </dl>
        {facts.skills.length > 0 ? (
          <div className='space-y-2'>
            <p className='text-muted-foreground text-sm'>Skills</p>
            <ul className='flex flex-wrap gap-1.5'>
              {facts.skills.map((skill) => (
                <li key={skill}>
                  <Badge variant='secondary'>{skill}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {facts.listing_is_incomplete ? (
          <p className='text-muted-foreground text-sm'>
            The listing looks incomplete, so some facts may be missing.
          </p>
        ) : null}
        {facts.is_likely_scam ? (
          <div className='text-destructive space-y-1 text-sm'>
            <p className='font-medium'>Possible scam</p>
            <ul className='list-disc space-y-0.5 pl-5'>
              {facts.scam_signals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface SignalListProps {
  title: string;
  items: string[];
  empty: string;
  tone?: 'default' | 'positive' | 'negative';
}

const TONE_MARKER: Record<NonNullable<SignalListProps['tone']>, string> = {
  default: 'bg-muted-foreground',
  positive: 'bg-emerald-500',
  negative: 'bg-destructive'
};

export function SignalList({ title, items, empty, tone = 'default' }: SignalListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{empty}</p>
        ) : (
          <ul className='space-y-2 text-sm'>
            {items.map((item, index) => (
              <li key={`${index}-${item}`} className='flex gap-2'>
                <span
                  aria-hidden
                  className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', TONE_MARKER[tone])}
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function TextSection({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className='text-sm leading-relaxed whitespace-pre-line'>{text}</p>
      </CardContent>
    </Card>
  );
}
