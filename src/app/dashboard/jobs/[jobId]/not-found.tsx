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
import Link from 'next/link';

export default function JobNotFound() {
  return (
    <div className='flex flex-1 flex-col px-4 pt-2 pb-4 md:px-6 md:pt-4'>
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.jobs />
          </EmptyMedia>
          <EmptyTitle>Job not found</EmptyTitle>
          <EmptyDescription>This job does not exist or the link is incomplete.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href='/dashboard/jobs' className={buttonVariants({ variant: 'outline' })}>
            Back to Jobs
          </Link>
        </EmptyContent>
      </Empty>
    </div>
  );
}
