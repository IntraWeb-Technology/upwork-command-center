// Fails when src/server/db/schema.ts has changes that are not captured in a committed migration.
// 1. drizzle-kit check validates the migration journal and snapshots.
// 2. A copy of drizzle/ is regenerated in a scratch directory; any new file means drift.
// drizzle-kit can exit 0 after printing an error, so error output is treated as failure.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const drizzleKit = join(root, 'node_modules', 'drizzle-kit', 'bin.cjs');

function run(args) {
  const result = spawnSync(process.execPath, [drizzleKit, ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 || /\bError\b/.test(output)) {
    process.stderr.write(output);
    console.error(`drizzle-kit ${args[0]} failed`);
    process.exit(1);
  }
  return output;
}

function listFiles(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`]
  );
}

run(['check', '--config', 'drizzle.config.ts']);

// drizzle-kit only resolves paths relative to cwd, so the scratch copy lives inside the repo.
const cacheDir = join(root, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const scratch = mkdtempSync(join(cacheDir, 'ucc-db-check-'));
try {
  const out = join(scratch, 'drizzle');
  cpSync(join(root, 'drizzle'), out, { recursive: true });
  const config = join(scratch, 'drizzle.config.mjs');
  const toPosix = (path) => `./${relative(root, path).replaceAll('\\', '/')}`;
  writeFileSync(
    config,
    `export default ${JSON.stringify({
      dialect: 'postgresql',
      schema: './src/server/db/schema.ts',
      out: toPosix(out),
      strict: true
    })};\n`
  );

  const before = new Set(listFiles(out));
  run(['generate', '--config', toPosix(config), '--name', 'drift_check']);
  const added = listFiles(out).filter((file) => !before.has(file));

  if (added.length > 0) {
    console.error('Schema drift: src/server/db/schema.ts has changes without a migration.');
    console.error('Run `bun run db:generate --name <change>` and commit the result.');
    console.error(`Would generate: ${added.join(', ')}`);
    process.exit(1);
  }
  console.log('Migrations are in sync with src/server/db/schema.ts.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
