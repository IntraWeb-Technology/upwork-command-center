'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

type BreadcrumbItem = {
  title: string;
  link: string;
};

// This allows to add custom title as well
const routeMapping: Record<string, BreadcrumbItem[]> = {
  '/dashboard': [{ title: 'Dashboard', link: '/dashboard' }],
  '/dashboard/employee': [
    { title: 'Dashboard', link: '/dashboard' },
    { title: 'Employee', link: '/dashboard/employee' }
  ]
  // Add more custom mappings as needed
};

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function segmentTitle(segments: string[], index: number): string {
  const segment = segments[index];
  if (UUID_SEGMENT.test(segment)) {
    return segments[index - 1] === 'jobs' ? 'Job' : 'Details';
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function useBreadcrumbs() {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => {
    // Check if we have a custom mapping for this exact path
    if (routeMapping[pathname]) {
      return routeMapping[pathname];
    }

    // If no exact match, fall back to generating breadcrumbs from the path
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((_segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      return {
        title: segmentTitle(segments, index),
        link: path
      };
    });
  }, [pathname]);

  return breadcrumbs;
}
