'use client';

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
import { declineJobMutation } from '../api/mutations';
import { declineJobSchema, type DeclineJobFormValues } from '../schemas/job';

interface DeclineDialogProps {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeclineDialog({ jobId, open, onOpenChange }: DeclineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Decline job</DialogTitle>
          <DialogDescription>
            The job moves to Declined. Its listing and analyses stay in the history.
          </DialogDescription>
        </DialogHeader>
        {open ? <DeclineForm jobId={jobId} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const defaultValues: DeclineJobFormValues = { reason: '' };

function DeclineForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const mutation = useMutation({
    ...declineJobMutation,
    onSuccess: () => {
      toast.success('Job declined');
      onDone();
    },
    onError: () => {
      toast.error("Couldn't decline the job. Try again.");
    }
  });

  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: declineJobSchema },
    onSubmit: ({ value }) => {
      mutation.mutate({ jobId, reason: value.reason.trim() });
    }
  });

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
          name='reason'
          children={(field) => (
            <field.TextareaField
              label='Reason'
              required
              rows={3}
              maxLength={1000}
              placeholder='Budget too low for the scope.'
            />
          )}
        />
      </FieldGroup>
      <DialogFooter>
        <LoadingButton
          type='submit'
          variant='destructive'
          loading={mutation.isPending}
          loadingLabel='Declining job.'
        >
          Decline job
        </LoadingButton>
      </DialogFooter>
    </form>
  );
}
