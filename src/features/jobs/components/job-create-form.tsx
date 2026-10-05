'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { useAppForm } from '@/lib/form';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createJobMutation } from '../api/mutations';
import { JobsApiError } from '../api/service';
import { MAX_LISTING_CHARS } from '../constants/job-options';
import { createJobSchema, type CreateJobFormValues } from '../schemas/job';

const defaultValues: CreateJobFormValues = { title: '', url: '', listing_text: '' };

export function JobCreateForm() {
  const router = useRouter();

  const mutation = useMutation({
    ...createJobMutation,
    onSuccess: ({ job }) => {
      router.push(`/dashboard/jobs/${job.id}?tab=analysis`);
    },
    onError: (error) => {
      if (error instanceof JobsApiError && error.code === 'JOB_EXISTS' && error.jobId) {
        const existingId = error.jobId;
        toast.error('This Upwork job is already saved.', {
          action: {
            label: 'Open job',
            onClick: () => router.push(`/dashboard/jobs/${existingId}`)
          }
        });
        return;
      }
      if (error instanceof JobsApiError && error.code === 'ANALYSIS_UNAVAILABLE') {
        toast.error('Analysis is not available right now. Nothing was saved.');
        return;
      }
      if (error instanceof JobsApiError && error.status === 400) {
        toast.error('Check the form and try again.');
        return;
      }
      toast.error("Couldn't save the job. Try again.");
    }
  });

  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: createJobSchema },
    onSubmit: ({ value }) => {
      mutation.mutate({
        title: value.title.trim(),
        url: value.url.trim() === '' ? null : value.url.trim(),
        listing_text: value.listing_text,
        analyze: true
      });
    }
  });

  return (
    <Card className='mx-auto w-full max-w-3xl'>
      <CardContent>
        <form
          className='space-y-8'
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField
              name='title'
              children={(field) => (
                <field.TextField
                  label='Title'
                  required
                  maxLength={300}
                  autoComplete='off'
                  placeholder='Senior Next.js developer for a SaaS dashboard'
                />
              )}
            />
            <form.AppField
              name='url'
              children={(field) => (
                <field.TextField
                  label='Upwork URL'
                  type='url'
                  inputMode='url'
                  autoComplete='off'
                  placeholder='https://www.upwork.com/jobs/...'
                  description='Optional. Used to detect a job you already saved.'
                />
              )}
            />
            <form.AppField
              name='listing_text'
              children={(field) => (
                <field.TextareaField
                  label='Full listing'
                  required
                  rows={14}
                  maxLength={MAX_LISTING_CHARS}
                  showCount
                  className='max-h-[60vh] font-mono text-sm'
                  placeholder='Paste the complete job post, including budget, client details, and activity.'
                  description='Saved as an immutable snapshot. The analysis always refers to this exact text.'
                />
              )}
            />
          </FieldGroup>

          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={() => router.back()}>
              Cancel
            </Button>
            <LoadingButton loading={mutation.isPending} loadingLabel='Saving job.' type='submit'>
              <Icons.sparkles aria-hidden /> Analyze Job
            </LoadingButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
