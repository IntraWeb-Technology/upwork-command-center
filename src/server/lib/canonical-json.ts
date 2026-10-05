import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in order, no whitespace.
 * Two values that differ only in key order serialize identically.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('canonicalJson does not accept non-finite numbers');
    }
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError(`canonicalJson does not accept ${typeof value}`);
    }
    if (typeof value === 'bigint') throw new TypeError('canonicalJson does not accept bigint');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
