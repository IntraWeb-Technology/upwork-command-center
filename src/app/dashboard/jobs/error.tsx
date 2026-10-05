'use client';

import { JobsError } from '@/features/jobs/components/jobs-error';

export default function JobsErrorBoundary(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <JobsError {...props} />;
}
