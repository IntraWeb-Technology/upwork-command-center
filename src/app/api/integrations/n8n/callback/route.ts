import { getDb } from '@/server/db/client';
import { getServerEnv } from '@/server/env';
import { handleN8nCallback } from '@/server/n8n/callback-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Machine-to-machine endpoint: authenticated by the shared bearer token and the per-run
// callback token, not by Clerk (see docs/persistence.md).
export async function POST(request: Request): Promise<Response> {
  return handleN8nCallback(request, {
    getDb,
    callbackToken: getServerEnv().N8N_CALLBACK_TOKEN
  });
}
