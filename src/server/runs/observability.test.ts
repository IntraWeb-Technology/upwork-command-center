import { describe, expect, it } from 'vitest';

import { sanitizeError } from './observability';

describe('sanitizeError', () => {
  it('drops messages that may carry SQL parameters, payloads, or hosts', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND db.internal.example'), {
      code: 'ENOTFOUND'
    });
    const error = new Error(
      'Failed query: update "workflow_runs" set "result" = $1\nparams: {"body":"synthetic proposal text"}',
      { cause }
    );

    const sanitized = sanitizeError('callback_processing_failed', error);

    expect(sanitized.message).toBe('callback_processing_failed: Error (ENOTFOUND)');
    expect(sanitized.stack).not.toContain('synthetic proposal text');
    expect(sanitized.stack).not.toContain('db.internal.example');
    expect(sanitized.stack).toMatch(/\n\s+at\s/);
  });

  it('handles non-Error values', () => {
    expect(sanitizeError('dispatch_transport_threw', 'boom').message).toBe(
      'dispatch_transport_threw: NonError'
    );
  });
});
