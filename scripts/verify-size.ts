/** NFR-4 bundle budgets (TECH_STACK.md §7). */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, listFiles } from './cli';

const KB = 1024;
export const CONTENT_SCRIPT = 'assets/content.js';
export const CONTENT_BUDGET = 120 * KB;
export const TOTAL_BUDGET = 500 * KB;
export const ASSET_BUDGET = 150 * KB;

export interface FileSize {
  file: string;
  bytes: number;
}

export interface SizeReport {
  total: number;
  errors: string[];
}

export function checkSizes(files: readonly FileSize[]): SizeReport {
  const errors: string[] = [];
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  const content = files.find((f) => f.file === CONTENT_SCRIPT);
  if (!content) errors.push(`${CONTENT_SCRIPT} missing`);
  else if (content.bytes > CONTENT_BUDGET) {
    errors.push(`${CONTENT_SCRIPT} is ${content.bytes} B, budget ${CONTENT_BUDGET} B`);
  }
  if (total > TOTAL_BUDGET) errors.push(`dist/ total is ${total} B, budget ${TOTAL_BUDGET} B`);
  for (const f of files) {
    if (f.bytes > ASSET_BUDGET) {
      errors.push(`${f.file} is ${f.bytes} B, per-asset budget ${ASSET_BUDGET} B`);
    }
  }
  return { total, errors };
}

if (isMain(import.meta.url)) {
  const dist = 'dist';
  if (!existsSync(dist)) {
    console.error('verify:size — dist/ not found; run the build first');
    process.exit(1);
  }
  const files = listFiles(dist).map((file) => ({ file, bytes: statSync(join(dist, file)).size }));
  const report = checkSizes(files);
  console.table(files.map((f) => ({ file: f.file, KB: (f.bytes / KB).toFixed(1) })));
  console.log(`total ${(report.total / KB).toFixed(1)} KB`);
  if (report.errors.length > 0) {
    console.error(`verify:size — budget exceeded:\n  ${report.errors.join('\n  ')}`);
    process.exit(1);
  }
  console.log('verify:size — OK');
}
