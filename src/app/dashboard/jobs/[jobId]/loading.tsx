import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className='flex flex-1 flex-col gap-4 px-4 pt-2 pb-4 md:px-6 md:pt-4'>
      <Skeleton className='h-8 w-2/3 max-w-xl' />
      <Skeleton className='h-4 w-1/3 max-w-sm' />
      <Skeleton className='h-9 w-80' />
      <div className='grid gap-4 lg:grid-cols-2'>
        <Skeleton className='h-56' />
        <Skeleton className='h-56' />
      </div>
    </div>
  );
}
