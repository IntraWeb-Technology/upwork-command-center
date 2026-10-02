interface AccessDeniedProps {
  action?: React.ReactNode;
}

export function AccessDenied({ action }: AccessDeniedProps) {
  return (
    <main className='flex min-h-screen items-center justify-center p-6'>
      <div role='alert' className='max-w-md space-y-4 text-center'>
        <h1 className='text-2xl font-semibold'>Access denied</h1>
        <p className='text-muted-foreground'>
          You are signed in, but this account is not authorized to use the Upwork Command Center.
        </p>
        {action}
      </div>
    </main>
  );
}
