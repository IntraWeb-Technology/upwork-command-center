'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LoadingButton } from '@/components/ui/loading-button';
import * as Sentry from '@sentry/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { JobsApiError } from '../api/service';

interface JobsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

function describe(error: Error): { title: string; message: string; retry: boolean } {
  if (error instanceof JobsApiError) {
    if (error.status === 401) {
      return { title: 'Signed out', message: 'Sign in again to continue.', retry: false };
    }
    if (error.status === 403) {
      return {
        title: 'Not authorized',
        message: 'This account is not authorized to use this application.',
        retry: false
      };
    }
    if (error.status === 404) {
      return { title: 'Job not found', message: 'This job does not exist.', retry: false };
    }
  }
  return {
    title: 'Something went wrong',
    message: 'Jobs could not be loaded. Try again in a moment.',
    retry: true
  };
}

export function JobsError({ error, reset }: JobsErrorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { title, message, retry } = describe(error);

  useEffect(() => {
    if (!(error instanceof JobsApiError) || error.status >= 500) Sentry.captureException(error);
  }, [error]);

  return (
    <div className='flex flex-1 flex-col px-4 pt-2 pb-4 md:px-6 md:pt-4'>
      <Alert variant='destructive'>
        <Icons.alertCircle aria-hidden />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <p>{message}</p>
          {retry ? (
            <LoadingButton
              variant='outline'
              size='sm'
              className='mt-3'
              loading={isPending}
              onClick={() =>
                startTransition(() => {
                  router.refresh();
                  reset();
                })
              }
            >
              Try again
            </LoadingButton>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  );
}
