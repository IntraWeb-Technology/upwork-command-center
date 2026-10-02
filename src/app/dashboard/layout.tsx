import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { InfoSidebar } from '@/components/layout/info-sidebar';
import { InfobarProvider } from '@/components/ui/infobar';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AccessDenied } from '@/features/auth/components/access-denied';
import { getOwnerAuthorization } from '@/server/auth/require-owner';
import { SignOutButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Personal control center for the Upwork Job Hunter Automation system.',
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Gate the whole /dashboard segment: redirect to sign-in when signed out.
  await auth.protect();
  const owner = await getOwnerAuthorization();
  if (!owner.ok) {
    return (
      <AccessDenied
        action={
          <SignOutButton>
            <Button variant='outline'>Sign out</Button>
          </SignOutButton>
        }
      />
    );
  }
  // Persisting the sidebar state in the cookie.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';
  return (
    <KBar>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a
          href='#main-content'
          className='bg-background ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:ring-2'
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset id='main-content' tabIndex={-1} className='scroll-mt-16'>
          <Header />
          <InfobarProvider defaultOpen={false}>
            {children}
            <InfoSidebar side='right' />
          </InfobarProvider>
        </SidebarInset>
      </SidebarProvider>
    </KBar>
  );
}
