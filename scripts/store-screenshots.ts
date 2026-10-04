/** `pnpm store:screenshots`: build the E2E bundle and capture store screenshots from fixtures. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const run = spawnSync('npx', ['playwright', 'test', 'tests/e2e/screenshots.spec.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PP_SCREENSHOTS: '1' },
});
process.exit(run.status ?? 1);
