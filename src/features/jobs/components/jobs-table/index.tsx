'use client';

import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { getSortingStateParser } from '@/lib/parsers';
import { useSuspenseQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { ACTIVE_RUN_POLL_MS, isRunActive, jobsQueryOptions } from '../../api/queries';
import type { JobFilters } from '../../api/types';
import { columns } from './columns';

const columnIds = columns.map((c) => c.id).filter(Boolean) as string[];

export function JobsTable() {
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    title: parseAsString,
    stage: parseAsString,
    sort: getSortingStateParser(columnIds).withDefault([])
  });

  const filters: JobFilters = {
    page: params.page,
    perPage: params.perPage,
    ...(params.title && { search: params.title }),
    ...(params.stage && { stage: params.stage }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };

  const { data } = useSuspenseQuery({
    ...jobsQueryOptions(filters),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => isRunActive(item.analysis_status))
        ? ACTIVE_RUN_POLL_MS
        : false
  });

  const pageCount = Math.ceil(data.total / params.perPage);

  const { table } = useDataTable({
    data: data.items,
    columns,
    pageCount,
    shallow: true,
    debounceMs: 500
  });

  const hasFilters = Boolean(params.title || params.stage);
  if (data.total === 0 && !hasFilters) return <NoJobs />;

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}

function NoJobs() {
  return (
    <Empty className='border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icons.jobs />
        </EmptyMedia>
        <EmptyTitle>No jobs yet</EmptyTitle>
        <EmptyDescription>
          Paste an Upwork listing to save a snapshot and get a scored analysis.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href='/dashboard/jobs/new' className={buttonVariants()}>
          <Icons.add className='mr-2 h-4 w-4' aria-hidden /> Analyze Job
        </Link>
      </EmptyContent>
    </Empty>
  );
}
