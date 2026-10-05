'use client';

import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { Icons } from '@/components/icons';
import type { Column, ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { JobListItem } from '../../api/types';
import { isRunActive } from '../../api/queries';
import { STAGE_OPTIONS } from '../../constants/job-options';
import { DateTime } from '../date-time';
import { DispositionBadge, StageBadge } from '../job-badges';

export const columns: ColumnDef<JobListItem>[] = [
  {
    id: 'title',
    accessorKey: 'title',
    header: ({ column }: { column: Column<JobListItem, unknown> }) => (
      <DataTableColumnHeader column={column} title='Title' />
    ),
    cell: ({ row }) => (
      <Link
        href={`/dashboard/jobs/${row.original.id}`}
        className='line-clamp-2 max-w-md font-medium hover:underline'
      >
        {row.original.title}
      </Link>
    ),
    meta: {
      label: 'Title',
      placeholder: 'Search jobs...',
      variant: 'text',
      icon: Icons.text
    },
    enableColumnFilter: true
  },
  {
    id: 'stage',
    accessorKey: 'stage',
    header: ({ column }: { column: Column<JobListItem, unknown> }) => (
      <DataTableColumnHeader column={column} title='Stage' />
    ),
    cell: ({ row }) => <StageBadge stage={row.original.stage} />,
    enableColumnFilter: true,
    meta: {
      label: 'Stage',
      variant: 'multiSelect',
      options: STAGE_OPTIONS
    }
  },
  {
    id: 'system_score',
    accessorKey: 'system_score',
    header: ({ column }: { column: Column<JobListItem, unknown> }) => (
      <DataTableColumnHeader column={column} title='System score' />
    ),
    cell: ({ row }) => {
      const {
        system_score: score,
        final_score: finalScore,
        has_override: overridden
      } = row.original;
      if (score === null) return <span className='text-muted-foreground'>-</span>;
      return (
        <div className='flex flex-col'>
          <span className='font-medium tabular-nums'>{score.toFixed(1)}</span>
          {overridden && finalScore !== null && finalScore !== score ? (
            <span className='text-muted-foreground text-xs tabular-nums'>
              Owner {finalScore.toFixed(1)}
            </span>
          ) : null}
        </div>
      );
    }
  },
  {
    id: 'disposition',
    accessorKey: 'final_disposition',
    enableSorting: false,
    header: 'Disposition',
    cell: ({ row }) => {
      const item = row.original;
      if (isRunActive(item.analysis_status)) {
        return (
          <Badge variant='outline'>
            <Icons.spinner className='animate-spin' aria-hidden />
            Analyzing
          </Badge>
        );
      }
      if (item.hard_filter_pass === false) {
        return <Badge variant='destructive'>Hard filter failed</Badge>;
      }
      if (item.final_disposition) {
        return <DispositionBadge disposition={item.final_disposition} />;
      }
      if (item.analysis_status === 'failed' || item.analysis_status === 'timed_out') {
        return <Badge variant='secondary'>Analysis failed</Badge>;
      }
      return <span className='text-muted-foreground'>Not analyzed</span>;
    }
  },
  {
    id: 'updated_at',
    accessorKey: 'updated_at',
    header: ({ column }: { column: Column<JobListItem, unknown> }) => (
      <DataTableColumnHeader column={column} title='Updated' />
    ),
    cell: ({ row }) => (
      <DateTime value={row.original.updated_at} className='text-muted-foreground text-sm' />
    )
  }
];
