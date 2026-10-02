import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ListingView } from '../api/types';
import { DateTime } from './date-time';

export function ListingPanel({ listing }: { listing: ListingView | null }) {
  if (!listing) {
    return <p className='text-muted-foreground text-sm'>No listing saved for this job.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listing snapshot</CardTitle>
        <CardDescription>
          Saved <DateTime value={listing.created_at} />.{' '}
          {listing.char_count.toLocaleString('en-US')} characters.
          {listing.snapshot_count > 1 ? ` ${listing.snapshot_count} snapshots in total.` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className='bg-muted/40 max-h-[70vh] overflow-auto rounded-lg border p-4 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap'>
          {listing.text}
        </pre>
      </CardContent>
    </Card>
  );
}
