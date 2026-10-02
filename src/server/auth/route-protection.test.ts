import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Only Clerk's public `auth()` result is replaced; the real route handlers,
// `withOwner`, env validation, and owner policy all run.
const clerkAuth = vi.hoisted(() => vi.fn<() => Promise<{ userId: string | null }>>());
vi.mock('@clerk/nextjs/server', () => ({ auth: clerkAuth }));

const OWNER = 'user_placeholderOwner';

type Handler = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

async function loadHandlers(): Promise<Array<[string, string, Handler]>> {
  const users = await import('@/app/api/users/route');
  const user = await import('@/app/api/users/[id]/route');

  return [
    ['GET', '/api/users', users.GET as Handler],
    ['POST', '/api/users', users.POST as Handler],
    ['PUT', '/api/users/1', user.PUT],
    ['DELETE', '/api/users/1', user.DELETE]
  ];
}

function call(handler: Handler, method: string, path: string): Promise<Response> {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    body: method === 'POST' || method === 'PUT' ? '{}' : undefined
  });
  return handler(request, { params: Promise.resolve({ id: '1' }) });
}

describe('reference API routes', () => {
  let handlers: Array<[string, string, Handler]>;

  // The mock data modules (faker) are slow to import on a cold start.
  beforeAll(async () => {
    handlers = await loadHandlers();
  }, 60_000);

  beforeEach(() => {
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_placeholder_value');
    vi.stubEnv('OWNER_CLERK_USER_ID', OWNER);
  });

  it('rejects unauthenticated requests to every handler with 401', async () => {
    clerkAuth.mockResolvedValue({ userId: null });

    for (const [method, path, handler] of handlers) {
      const response = await call(handler, method, path);
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    }
  });

  it('rejects authenticated non-owners from every handler with 403', async () => {
    clerkAuth.mockResolvedValue({ userId: 'user_someoneElse' });

    for (const [method, path, handler] of handlers) {
      const response = await call(handler, method, path);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
  });

  it('serves the owner', async () => {
    clerkAuth.mockResolvedValue({ userId: OWNER });
    const { GET } = await import('@/app/api/users/route');

    const response = await GET(new NextRequest('http://localhost/api/users?limit=2'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { users: unknown[] };
    expect(body.users).toHaveLength(2);
  });

  it('fails closed when the owner is not configured', async () => {
    vi.stubEnv('OWNER_CLERK_USER_ID', '');
    clerkAuth.mockResolvedValue({ userId: OWNER });
    const { GET } = await import('@/app/api/users/route');

    await expect(GET(new NextRequest('http://localhost/api/users'))).rejects.toThrow(
      'OWNER_CLERK_USER_ID is required'
    );
  });
});
