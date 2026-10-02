// Client data access for the Jobs feature. Calls the Command Center route handlers;
// the browser never talks to n8n.

import type {
  ApiErrorBody,
  CreateJobPayload,
  CreateJobResponse,
  JobDetail,
  JobFilters,
  JobListResponse,
  OverridePayload,
  StartAnalysisResponse,
  WorkflowRunView
} from './types';

export class JobsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly jobId: string | undefined;
  readonly runId: string | undefined;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? `Request failed with status ${status}`);
    this.name = 'JobsApiError';
    this.status = status;
    this.code = body?.error.code ?? 'UNKNOWN';
    this.jobId = body?.error.job_id;
    this.runId = body?.error.run_id;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store'
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new JobsApiError(response.status, isApiErrorBody(body) ? body : null);
  }

  return (await response.json()) as T;
}

export async function getJobs(filters: JobFilters): Promise<JobListResponse> {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.perPage) params.set('perPage', String(filters.perPage));
  if (filters.search) params.set('search', filters.search);
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.sort) params.set('sort', filters.sort);
  const query = params.toString();
  return request<JobListResponse>(`/jobs${query ? `?${query}` : ''}`);
}

export async function getJob(jobId: string): Promise<JobDetail> {
  return request<JobDetail>(`/jobs/${encodeURIComponent(jobId)}`);
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunView> {
  return request<WorkflowRunView>(`/workflow-runs/${encodeURIComponent(runId)}`);
}

export async function createJob(payload: CreateJobPayload): Promise<CreateJobResponse> {
  return request<CreateJobResponse>('/jobs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function startAnalysis(jobId: string): Promise<StartAnalysisResponse> {
  return request<StartAnalysisResponse>(`/jobs/${encodeURIComponent(jobId)}/analyses`, {
    method: 'POST'
  });
}

export async function declineJob(jobId: string, reason: string): Promise<JobDetail> {
  return request<JobDetail>(`/jobs/${encodeURIComponent(jobId)}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ to_stage: 'declined', reason })
  });
}

export async function overrideAnalysis(
  jobId: string,
  payload: OverridePayload
): Promise<JobDetail> {
  return request<JobDetail>(`/jobs/${encodeURIComponent(jobId)}/override`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}
