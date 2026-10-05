import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { startAnalysis } from '@/server/analyses/start';
import type { Database } from '@/server/db/client';
import type { AnalysisRuntime } from '@/server/n8n/runtime';
import { isUuid } from '@/server/runs/ids';
import { sanitizeError } from '@/server/runs/observability';

import { JobDomainError, type JobErrorCode } from './errors';
import { MAX_LISTING_CHARS } from './listing-text';
import { getJobDetail, getWorkflowRunView, listJobs, toRunView } from './read-models';
import { addListingSnapshot, createManualJob, declineJob, overrideAnalysis } from './repository';

export interface JobsHttpDeps {
  getDb: () => Database;
  getRuntime: (requestOrigin: string) => AnalysisRuntime;
  now?: () => Date;
}

type RouteContext<P extends string> = { params: Promise<Record<P, string>> };
export type IdRouteContext = RouteContext<'id'>;

const NO_STORE = { 'cache-control': 'no-store' };

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, string> = {}
): Response {
  return json(status, { error: { code, message, ...extra } });
}

const DOMAIN_STATUS: Record<JobErrorCode, number> = {
  NOT_FOUND: 404,
  JOB_EXISTS: 409,
  NO_LISTING: 409,
  NO_ANALYSIS: 409,
  ACTIVE_RUN: 409,
  INVALID_STAGE: 409,
  INVALID_INPUT: 400,
  ANALYSIS_UNAVAILABLE: 503
};

function domainResponse(error: JobDomainError): Response {
  if (error.code === 'ANALYSIS_UNAVAILABLE') {
    // The detail names configuration; it stays in the server log.
    console.error('[jobs] analysis unavailable', { reason: error.message });
    return errorResponse(503, error.code, 'Analysis is not available right now.');
  }
  const extra: Record<string, string> = {};
  if (error.details.jobId) extra.job_id = error.details.jobId;
  if (error.details.runId) extra.run_id = error.details.runId;
  return errorResponse(DOMAIN_STATUS[error.code], error.code, error.message, extra);
}

async function guarded(event: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof JobDomainError) return domainResponse(error);
    const sanitized = sanitizeError(event, error);
    console.error(`[jobs] ${event}`, { error: sanitized.message });
    Sentry.captureException(sanitized);
    return errorResponse(500, 'INTERNAL', 'Something went wrong.');
  }
}

async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'INVALID_INPUT', 'Request body must be JSON.')
    };
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  // Field paths and rule messages only; submitted values are never echoed.
  const fields = [
    ...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)'))
  ];
  return {
    ok: false,
    response: json(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Some fields are invalid.',
        fields: Object.fromEntries(
          fields.map((field) => [
            field,
            parsed.error.issues.find(
              (issue) => (issue.path.map(String).join('.') || '(root)') === field
            )?.message
          ])
        )
      }
    })
  };
}

async function jobIdFrom(context: RouteContext<'id'>): Promise<string | null> {
  const { id } = await context.params;
  return isUuid(id) ? id : null;
}

const notFound = () => errorResponse(404, 'NOT_FOUND', 'Job not found.');

const httpUrl = z
  .url({ protocol: /^https?$/, error: 'Enter a valid http(s) URL.' })
  .max(2000, { error: 'URL is too long.' });

const listingText = z
  .string({ error: 'Listing text is required.' })
  .max(MAX_LISTING_CHARS, { error: 'Listing text is too long.' })
  .refine((text) => text.trim().length > 0, { error: 'Listing text is required.' });

export const createJobSchema = z.strictObject({
  title: z
    .string({ error: 'Title is required.' })
    .trim()
    .min(1, { error: 'Title is required.' })
    .max(300, { error: 'Title must be 300 characters or fewer.' }),
  url: z
    .union([httpUrl, z.literal(''), z.null()])
    .optional()
    .transform((value) => value || null),
  listing_text: listingText,
  analyze: z.boolean().optional().default(true)
});

const addListingSchema = z.strictObject({ listing_text: listingText });

const transitionSchema = z.strictObject({
  to_stage: z.literal('declined', { error: 'Only "declined" is supported.' }),
  reason: z
    .string({ error: 'A reason is required.' })
    .trim()
    .min(1, { error: 'A reason is required.' })
    .max(1000, { error: 'Reason must be 1000 characters or fewer.' })
});

const overrideSchema = z.strictObject({
  manual_score: z.number().min(1).max(10).multipleOf(0.1).nullable(),
  manual_disposition: z.enum(['PRIORITY', 'REVIEW', 'LOW']).nullable(),
  reason: z.string().trim().max(1000).nullable()
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  perPage: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
  search: z.string().max(200).optional().catch(undefined),
  stage: z.string().max(200).optional().catch(undefined),
  sort: z.string().max(500).optional().catch(undefined)
});

// Handlers

export function handleListJobs(request: Request, deps: JobsHttpDeps): Promise<Response> {
  return guarded('jobs_list_failed', async () => {
    const query = listQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries())
    );
    return json(200, await listJobs(deps.getDb(), query, deps.now?.()));
  });
}

export function handleCreateJob(request: Request, deps: JobsHttpDeps): Promise<Response> {
  return guarded('jobs_create_failed', async () => {
    const body = await readJson(request, createJobSchema);
    if (!body.ok) return body.response;
    const db = deps.getDb();
    // Resolve the transport first so a misconfigured mode fails before a job is created.
    const runtime = body.data.analyze ? deps.getRuntime(new URL(request.url).origin) : null;
    const { job } = await createManualJob(db, {
      title: body.data.title,
      url: body.data.url,
      listingText: body.data.listing_text,
      now: deps.now?.()
    });
    let run = null;
    if (runtime) {
      const started = await startAnalysis(
        { db, transport: runtime.transport, callbackUrl: runtime.callbackUrl, now: deps.now },
        job.id
      );
      run = toRunView(started.run, deps.now?.());
    }
    const detail = await getJobDetail(db, job.id, deps.now?.());
    return json(201, { job: detail, run });
  });
}

export function handleGetJob(
  _request: Request,
  context: RouteContext<'id'>,
  deps: JobsHttpDeps
): Promise<Response> {
  return guarded('jobs_get_failed', async () => {
    const jobId = await jobIdFrom(context);
    if (!jobId) return notFound();
    const detail = await getJobDetail(deps.getDb(), jobId, deps.now?.());
    return detail ? json(200, detail) : notFound();
  });
}

export function handleAddListing(
  request: Request,
  context: RouteContext<'id'>,
  deps: JobsHttpDeps
): Promise<Response> {
  return guarded('jobs_add_listing_failed', async () => {
    const jobId = await jobIdFrom(context);
    if (!jobId) return notFound();
    const body = await readJson(request, addListingSchema);
    if (!body.ok) return body.response;
    const { listing, created } = await addListingSnapshot(deps.getDb(), jobId, {
      text: body.data.listing_text,
      now: deps.now?.()
    });
    return json(created ? 201 : 200, {
      listing: { id: listing.id, char_count: listing.charCount, created_at: listing.createdAt },
      created
    });
  });
}

export function handleStartAnalysis(
  request: Request,
  context: RouteContext<'id'>,
  deps: JobsHttpDeps
): Promise<Response> {
  return guarded('jobs_start_analysis_failed', async () => {
    const jobId = await jobIdFrom(context);
    if (!jobId) return notFound();
    const runtime = deps.getRuntime(new URL(request.url).origin);
    const { run } = await startAnalysis(
      {
        db: deps.getDb(),
        transport: runtime.transport,
        callbackUrl: runtime.callbackUrl,
        now: deps.now
      },
      jobId
    );
    return json(202, { run: toRunView(run, deps.now?.()) });
  });
}

export function handleTransition(
  request: Request,
  context: RouteContext<'id'>,
  deps: JobsHttpDeps
): Promise<Response> {
  return guarded('jobs_transition_failed', async () => {
    const jobId = await jobIdFrom(context);
    if (!jobId) return notFound();
    const body = await readJson(request, transitionSchema);
    if (!body.ok) return body.response;
    const db = deps.getDb();
    await declineJob(db, jobId, { reason: body.data.reason, now: deps.now?.() });
    return json(200, await getJobDetail(db, jobId, deps.now?.()));
  });
}

export function handleOverride(
  request: Request,
  context: RouteContext<'id'>,
  deps: JobsHttpDeps
): Promise<Response> {
  return guarded('jobs_override_failed', async () => {
    const jobId = await jobIdFrom(context);
    if (!jobId) return notFound();
    const body = await readJson(request, overrideSchema);
    if (!body.ok) return body.response;
    const db = deps.getDb();
    await overrideAnalysis(db, jobId, {
      manualScore: body.data.manual_score,
      manualDisposition: body.data.manual_disposition,
      reason: body.data.reason,
      now: deps.now?.()
    });
    return json(200, await getJobDetail(db, jobId, deps.now?.()));
  });
}

export function handleGetWorkflowRun(
  _request: Request,
  context: RouteContext<'id'>,
  deps: JobsHttpDeps
): Promise<Response> {
  return guarded('workflow_run_get_failed', async () => {
    const { id } = await context.params;
    const view = isUuid(id) ? await getWorkflowRunView(deps.getDb(), id, deps.now?.()) : null;
    return view ? json(200, view) : errorResponse(404, 'NOT_FOUND', 'Run not found.');
  });
}
