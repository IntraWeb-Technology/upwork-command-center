import { describe, expect, it } from 'vitest';
import { authorizeOwner } from './owner';

const OWNER = 'user_placeholderOwner';

describe('authorizeOwner', () => {
  it('denies an unauthenticated request with 401', () => {
    expect(authorizeOwner(null, OWNER)).toEqual({
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED'
    });
    expect(authorizeOwner(undefined, OWNER)).toMatchObject({ ok: false, status: 401 });
  });

  it('allows the configured owner', () => {
    expect(authorizeOwner(OWNER, OWNER)).toEqual({ ok: true, userId: OWNER });
  });

  it('denies any other authenticated user with 403', () => {
    expect(authorizeOwner('user_someoneElse', OWNER)).toEqual({
      ok: false,
      status: 403,
      code: 'FORBIDDEN'
    });
  });

  it('does not treat a prefix of the owner ID as the owner', () => {
    expect(authorizeOwner(OWNER.slice(0, -1), OWNER)).toMatchObject({ ok: false, status: 403 });
  });
});
