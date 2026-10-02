export type JobErrorCode =
  | 'NOT_FOUND'
  | 'JOB_EXISTS'
  | 'NO_LISTING'
  | 'NO_ANALYSIS'
  | 'ACTIVE_RUN'
  | 'INVALID_STAGE'
  | 'INVALID_INPUT'
  | 'ANALYSIS_UNAVAILABLE';

/** Expected domain outcomes; route handlers map them to HTTP responses. */
export class JobDomainError extends Error {
  constructor(
    readonly code: JobErrorCode,
    message: string,
    readonly details: { jobId?: string; runId?: string } = {}
  ) {
    super(message);
    this.name = 'JobDomainError';
  }
}
