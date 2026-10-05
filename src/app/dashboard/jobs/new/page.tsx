import PageContainer from '@/components/layout/page-container';
import { JobCreateForm } from '@/features/jobs/components/job-create-form';

export const metadata = {
  title: 'Dashboard: Analyze Job'
};

export default function NewJobPage() {
  return (
    <PageContainer
      pageTitle='Analyze Job'
      pageDescription='Paste a listing to save a snapshot and score it.'
    >
      <JobCreateForm />
    </PageContainer>
  );
}
