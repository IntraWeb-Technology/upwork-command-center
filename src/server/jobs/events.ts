import 'server-only';

import type { DbExecutor } from '@/server/db/client';
import { jobEvents, type JOB_EVENT_TYPES, type JOB_STAGES } from '@/server/db/schema';
import { uuidv7 } from '@/server/runs/ids';

export interface AppendJobEventInput {
  jobId: string;
  type: (typeof JOB_EVENT_TYPES)[number];
  actor: 'owner' | 'system' | 'n8n';
  occurredAt: Date;
  fromStage?: (typeof JOB_STAGES)[number] | null;
  toStage?: (typeof JOB_STAGES)[number] | null;
  workflowRunId?: string | null;
  /** Small structured facts only. Never listing text, tokens, or proposal bodies. */
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export async function appendJobEvent(db: DbExecutor, input: AppendJobEventInput): Promise<void> {
  await db.insert(jobEvents).values({
    id: uuidv7(input.occurredAt),
    jobId: input.jobId,
    type: input.type,
    actor: input.actor,
    fromStage: input.fromStage ?? null,
    toStage: input.toStage ?? null,
    occurredAt: input.occurredAt,
    workflowRunId: input.workflowRunId ?? null,
    payload: input.payload ?? {},
    idempotencyKey: input.idempotencyKey ?? null
  });
}
