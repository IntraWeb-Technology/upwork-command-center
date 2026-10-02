import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const FIXTURE_ROOT = path.resolve(process.cwd(), 'contracts/fixtures');

// Tests deliberately corrupt fixtures at arbitrary depth to prove the schemas reject them,
// which no precise type can express. Confined to test code; contracts themselves stay typed.
// oxlint-disable-next-line typescript/no-explicit-any
export type MutableJson = Record<string, any>;

export interface ContractFixture {
  group: string;
  validity: 'valid' | 'invalid';
  kind: string;
  file: string;
  data: unknown;
}

export function loadFixture(group: string, validity: 'valid' | 'invalid', file: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURE_ROOT, group, validity, file), 'utf8'));
}

// Layout: contracts/fixtures/<group>/<valid|invalid>/<kind>.<scenario>.json
export function listFixtures(): ContractFixture[] {
  const fixtures: ContractFixture[] = [];
  for (const group of readdirSync(FIXTURE_ROOT)) {
    for (const validity of ['valid', 'invalid'] as const) {
      let files: string[];
      try {
        files = readdirSync(path.join(FIXTURE_ROOT, group, validity));
      } catch {
        continue;
      }
      for (const file of files) {
        fixtures.push({
          group,
          validity,
          kind: file.split('.')[0],
          file,
          data: loadFixture(group, validity, file)
        });
      }
    }
  }
  return fixtures;
}

// Deep clone helper for building variants of a fixture inside a test.
export function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}
