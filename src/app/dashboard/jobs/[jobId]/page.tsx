import PageContainer from '@/components/layout/page-container';
import { jobKeys } from '@/features/jobs/api/queries';
import { JobWorkspace } from '@/features/jobs/components/job-workspace';
import { isOwnerRequest, readJobDetail } from '@/features/jobs/server/job-reads';
import { getQueryClient } from '@/lib/query-client';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { notFound } from 'next/navigation';

export const metadata = {
  title: 'Dashboard: Job'
};

interface JobPageProps {
  params: Promise<{ jobId: string }>;
}

export default async function JobPage(props: JobPageProps) {
  const { jobId } = await props.params;
  if (!(await isOwnerRequest())) return null;
  // Awaited because the page title and notFound() both depend on the job.
  const job = await readJobDetail(jobId);
  if (!job) notFound();

  const queryClient = getQueryClient();
  queryClient.setQueryData(jobKeys.detail(job.id), job);

  return (
    <PageContainer pageTitle={job.title} pageDescription='Listing, analysis, and history.'>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <JobWorkspace jobId={job.id} />
      </HydrationBoundary>
    </PageContainer>
  );
}
