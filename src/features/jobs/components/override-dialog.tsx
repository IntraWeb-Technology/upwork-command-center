'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { useAppForm } from '@/lib/form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { overrideAnalysisMutation } from '../api/mutations';
import type { Disposition, JobDetail, OverridePayload } from '../api/types';
import { DISPOSITION_LABELS, DISPOSITION_OPTIONS } from '../constants/job-options';
import { SYSTEM_DISPOSITION, overrideSchema, type OverrideFormValues } from '../schemas/job';

interface OverrideDialogProps {
  job: JobDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function toPayload(value: OverrideFormValues): OverridePayload {
  const reason = value.reason.trim();
  return {
    manual_score: value.manual_score.trim() === '' ? null : Number(value.manual_score),
    manual_disposition:
      value.manual_disposition === SYSTEM_DISPOSITION
        ? null
        : (value.manual_disposition as Disposition),
    reason: reason === '' ? null : reason
  };
}

export function OverrideDialog({ job, open, onOpenChange }: OverrideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Override analysis</DialogTitle>
          <DialogDescription>
            Your values sit alongside the system result. The analysis itself never changes.
          </DialogDescription>
        </DialogHeader>
        {open ? <OverrideForm job={job} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function OverrideForm({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const systemDisposition = job.analysis?.system_disposition ?? null;
  const hasOverride =
    job.override.manual_score !== null || job.override.manual_disposition !== null;

  const mutation = useMutation({
    ...overrideAnalysisMutation,
    onSuccess: (_detail, variables) => {
      const cleared =
        variables.payload.manual_score === null && variables.payload.manual_disposition === null;
      toast.success(cleared ? 'Override cleared' : 'Override saved');
      onDone();
    },
    onError: () => {
      toast.error("Couldn't save the override. Try again.");
    }
  });

  const defaultValues: OverrideFormValues = {
    manual_score: job.override.manual_score !== null ? job.override.manual_score.toFixed(1) : '',
    manual_disposition: job.override.manual_disposition ?? SYSTEM_DISPOSITION,
    reason: job.override.reason ?? '',
    system_disposition: systemDisposition ?? ''
  };

  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: overrideSchema },
    onSubmit: ({ value }) => {
      mutation.mutate({ jobId: job.id, payload: toPayload(value) });
    }
  });

  const dispositionOptions = [
    {
      value: SYSTEM_DISPOSITION,
      label: systemDisposition
        ? `Use system value (${DISPOSITION_LABELS[systemDisposition]})`
        : 'Use system value'
    },
    ...DISPOSITION_OPTIONS
  ];

  return (
    <form
      noValidate
      className='space-y-6'
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField
          name='manual_score'
          children={(field) => (
            <field.TextField
              label='Owner score'
              inputMode='decimal'
              autoComplete='off'
              placeholder={
                job.analysis?.system_score !== null && job.analysis?.system_score !== undefined
                  ? `System: ${job.analysis.system_score.toFixed(1)}`
                  : '1 to 10'
              }
              description='Leave empty to keep the system score.'
            />
          )}
        />
        <form.AppField
          name='manual_disposition'
          children={(field) => (
            <field.RadioGroupField label='Owner disposition' options={dispositionOptions} />
          )}
        />
        <form.AppField
          name='reason'
          children={(field) => (
            <field.TextareaField
              label='Reason'
              rows={3}
              maxLength={1000}
              description='Required when you change the disposition.'
            />
          )}
        />
      </FieldGroup>
      <DialogFooter>
        {hasOverride ? (
          <Button
            type='button'
            variant='ghost'
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                jobId: job.id,
                payload: { manual_score: null, manual_disposition: null, reason: null }
              })
            }
          >
            Clear override
          </Button>
        ) : null}
        <LoadingButton type='submit' loading={mutation.isPending} loadingLabel='Saving override.'>
          Save override
        </LoadingButton>
      </DialogFooter>
    </form>
  );
}
