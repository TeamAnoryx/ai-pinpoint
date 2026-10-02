/** `pnpm dev`: run both Vite builds in watch mode (D-001). Load dist/ unpacked. */
import { spawn } from 'node:child_process';

const builds = [
  ['vite', 'build', '--mode', 'development', '--watch'],
  ['vite', 'build', '--config', 'vite.content.config.ts', '--mode', 'development', '--watch'],
];

// Content build waits briefly so the main build's emptyOutDir does not wipe its output.
const CONTENT_START_DELAY_MS = 3000;

builds.forEach((args, i) => {
  setTimeout(() => {
    const child = spawn('pnpm', ['exec', ...args], { stdio: 'inherit', shell: true });
    child.on('exit', (code) => process.exit(code ?? 0));
  }, i * CONTENT_START_DELAY_MS);
});
