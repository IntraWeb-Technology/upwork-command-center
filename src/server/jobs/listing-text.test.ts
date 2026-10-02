import { describe, expect, it } from 'vitest';

import { canonicalHash, canonicalJson } from '@/server/lib/canonical-json';

import { hashListingText, normalizeListingText, parseUpworkRef } from './listing-text';

describe('canonicalJson', () => {
  it('is independent of key order at every depth', () => {
    const a = { b: 1, a: { y: [1, { q: true, p: null }], x: 'v' } };
    const b = { a: { x: 'v', y: [1, { p: null, q: true }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
    expect(canonicalJson(a)).toBe('{"a":{"x":"v","y":[1,{"p":null,"q":true}]},"b":1}');
  });

  it('keeps array order significant and detects value changes', () => {
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    expect(canonicalHash({ w: 0.25 })).not.toBe(canonicalHash({ w: 0.26 }));
  });

  it('drops undefined properties and rejects non-JSON values', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson([undefined])).toThrow();
  });
});

describe('listing text', () => {
  it('hashes whitespace-only differences identically', () => {
    const pasted = '  Build a dashboard\r\nWith tests   \r\n\r\nBudget 3000\t ';
    const clean = 'Build a dashboard\nWith tests\n\nBudget 3000';
    expect(normalizeListingText(pasted)).toBe(clean);
    expect(hashListingText(pasted)).toBe(hashListingText(clean));
  });

  it('treats any wording change as a different listing', () => {
    expect(hashListingText('Budget 3000')).not.toBe(hashListingText('Budget 3500'));
    expect(hashListingText('a b')).not.toBe(hashListingText('a  b'));
  });

  it('extracts Upwork references only from Upwork URLs', () => {
    expect(parseUpworkRef('https://www.upwork.com/jobs/~01AbCdEf0123456789')).toBe(
      '~01abcdef0123456789'
    );
    expect(parseUpworkRef('https://www.upwork.com/jobs/Next-dashboard_~01abcdef01234567/')).toBe(
      '~01abcdef01234567'
    );
    expect(parseUpworkRef('https://example.com/jobs/~01abcdef0123456789')).toBeNull();
    expect(parseUpworkRef('https://www.upwork.com/nx/find-work/')).toBeNull();
    expect(parseUpworkRef('not a url')).toBeNull();
    expect(parseUpworkRef(null)).toBeNull();
  });
});
