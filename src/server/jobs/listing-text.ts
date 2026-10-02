import { sha256Hex } from '@/server/lib/canonical-json';

export const MAX_LISTING_CHARS = 100_000;

/**
 * Normalization used only for deduplication hashing; the raw text is stored as pasted.
 * Unicode NFC, LF line endings, no trailing whitespace per line, trimmed ends.
 * Deliberately not fuzzy: any change to words or their order yields a different hash.
 */
export function normalizeListingText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+$/u, ''))
    .join('\n')
    .trim();
}

export function hashListingText(text: string): string {
  return sha256Hex(normalizeListingText(text));
}

const UPWORK_HOST = /(^|\.)upwork\.com$/i;
const UPWORK_REF = /~0[0-9a-z]{10,}/i;

/** Upwork ciphertext reference (`~01...`) from a job URL, if the URL is an Upwork URL. */
export function parseUpworkRef(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!UPWORK_HOST.test(parsed.hostname)) return null;
  return UPWORK_REF.exec(parsed.pathname)?.[0].toLowerCase() ?? null;
}
