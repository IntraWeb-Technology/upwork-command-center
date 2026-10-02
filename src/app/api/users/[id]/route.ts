// ============================================================
// Route Handler — Single User (update + delete)
// ============================================================
// See src/app/api/users/route.ts for pattern documentation.
// ============================================================

import { fakeUsers } from '@/constants/mock-api-users';
import { NextRequest, NextResponse } from 'next/server';
import { withOwner } from '@/server/auth/require-owner';

type Params = { params: Promise<{ id: string }> };

export const PUT = withOwner(async (request: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await request.json();
  const data = await fakeUsers.updateUser(Number(id), body);

  if (!data.success) {
    return NextResponse.json(data, { status: 404 });
  }

  return NextResponse.json(data);
});

export const DELETE = withOwner(async (request: NextRequest, { params }: Params) => {
  const { id } = await params;
  const data = await fakeUsers.deleteUser(Number(id));

  if (!data.success) {
    return NextResponse.json(data, { status: 404 });
  }

  return NextResponse.json(data);
});
