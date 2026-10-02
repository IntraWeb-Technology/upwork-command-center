// ============================================================
// Route Handler — Single Product (get + update)
// ============================================================
// See src/app/api/products/route.ts for pattern documentation.
// ============================================================

import { fakeProducts } from '@/constants/mock-api';
import { NextRequest, NextResponse } from 'next/server';
import { withOwner } from '@/server/auth/require-owner';

type Params = { params: Promise<{ id: string }> };

export const GET = withOwner(async (request: NextRequest, { params }: Params) => {
  const { id } = await params;
  const data = await fakeProducts.getProductById(Number(id));

  if (!data.success) {
    return NextResponse.json(data, { status: 404 });
  }

  return NextResponse.json(data);
});

export const PUT = withOwner(async (request: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await request.json();
  const data = await fakeProducts.updateProduct(Number(id), body);

  if (!data.success) {
    return NextResponse.json(data, { status: 404 });
  }

  return NextResponse.json(data);
});

export const DELETE = withOwner(async (request: NextRequest, { params }: Params) => {
  const { id } = await params;
  const data = await fakeProducts.deleteProduct(Number(id));

  if (!data.success) {
    return NextResponse.json(data, { status: 404 });
  }

  return NextResponse.json(data);
});
