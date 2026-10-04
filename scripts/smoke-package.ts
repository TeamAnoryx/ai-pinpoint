/**
 * `pnpm smoke:package`: extract the release zip to release/unpacked and run the packaged-build
 * smoke test against it (BUILD_PLAN Phase 9 DoD).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractZip } from './zip';

const ROOT = join(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const dir = join(ROOT, 'release', 'unpacked');
extractZip(join(ROOT, 'release', `ai-pinpoint-${version}.zip`), dir);
const run = spawnSync('npx', ['playwright', 'test', 'tests/e2e/package.spec.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PP_EXT_DIR: dir },
});
process.exit(run.status ?? 1);
