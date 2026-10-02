import { DataTableSkeleton } from '@/components/ui/table/data-table-skeleton';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { Suspense } from 'react';
import type { JobFilters } from '../api/types';
import { isOwnerRequest, serverJobsQueryOptions } from '../server/job-reads';
import { JobsTable } from './jobs-table';

export default async function JobListing() {
  if (!(await isOwnerRequest())) return null;

  const title = searchParamsCache.get('title');
  const stage = searchParamsCache.get('stage');
  const sort = searchParamsCache.get('sort');

  const filters: JobFilters = {
    page: searchParamsCache.get('page'),
    perPage: searchParamsCache.get('perPage'),
    ...(title && { search: title }),
    ...(stage && { stage }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(serverJobsQueryOptions(filters));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<DataTableSkeleton columnCount={5} rowCount={10} filterCount={2} />}>
        <JobsTable />
      </Suspense>
    </HydrationBoundary>
  );
}
