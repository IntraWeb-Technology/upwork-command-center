import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { buttonVariants } from '@/components/ui/button';
import JobListing from '@/features/jobs/components/job-listing';
import { searchParamsCache } from '@/lib/searchparams';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: Jobs'
};

interface JobsPageProps {
  searchParams: Promise<SearchParams>;
}

export default async function JobsPage(props: JobsPageProps) {
  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      pageTitle='Jobs'
      pageDescription='Listings you pasted, with their latest analysis.'
      pageHeaderAction={
        <Link href='/dashboard/jobs/new' className={cn(buttonVariants(), 'text-xs md:text-sm')}>
          <Icons.add className='mr-2 h-4 w-4' aria-hidden /> Analyze Job
        </Link>
      }
    >
      <JobListing />
    </PageContainer>
  );
}
