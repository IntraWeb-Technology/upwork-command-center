import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildContractJsonSchemas, JSON_SCHEMA_DIR } from './json-schema';

const schemaDir = path.resolve(process.cwd(), JSON_SCHEMA_DIR);
const writeMode = process.env.CONTRACTS_WRITE === '1';

function committedFiles(): Record<string, string> {
  let names: string[] = [];
  try {
    names = readdirSync(schemaDir).filter((name) => name.endsWith('.json'));
  } catch {
    return {};
  }
  return Object.fromEntries(
    names.map((name) => [name, readFileSync(path.join(schemaDir, name), 'utf8')])
  );
}

describe('generated JSON Schema', () => {
  it('is deterministic', () => {
    expect(buildContractJsonSchemas()).toEqual(buildContractJsonSchemas());
  });

  it.runIf(writeMode)('writes contracts/json-schema', () => {
    rmSync(schemaDir, { recursive: true, force: true });
    mkdirSync(schemaDir, { recursive: true });
    for (const [name, contents] of Object.entries(buildContractJsonSchemas())) {
      writeFileSync(path.join(schemaDir, name), contents);
    }
  });

  it.skipIf(writeMode)('matches the committed files (run `bun run contracts:generate`)', () => {
    const expected = buildContractJsonSchemas();
    const actual = committedFiles();
    expect(Object.keys(actual).toSorted()).toEqual(Object.keys(expected).toSorted());
    for (const [name, contents] of Object.entries(expected)) {
      expect(actual[name], `${name} is stale`).toBe(contents);
    }
  });
});
