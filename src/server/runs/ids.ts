import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUIDv7: 48-bit Unix millisecond timestamp, version 7, variant 10, 74 random bits.
 * Time-ordered, so new rows append to the primary key index instead of scattering.
 */
export function uuidv7(now: Date = new Date()): string {
  const bytes = randomBytes(16);
  // A 48-bit millisecond timestamp is exact in a double, so plain arithmetic is safe.
  const ms = now.getTime();
  for (let i = 0; i < 6; i++) {
    bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
