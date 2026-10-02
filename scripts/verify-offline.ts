/**
 * R1 enforcement: scans every built JS/HTML/CSS file in dist/ for network-capable identifiers
 * and absolute URLs outside the allowlist (TECH_STACK.md §7, ARCHITECTURE.md §9).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DISPLAY_URLS, HOST_ORIGINS, NAMESPACE_URIS } from './allowlist';
import { isMain, listFiles } from './cli';

export interface Violation {
  file: string;
  line: number;
  column: number;
  rule: string;
  match: string;
  context: string;
}

const BANNED: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'fetch', pattern: /\bfetch\s*\(/g },
  { rule: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/g },
  { rule: 'WebSocket', pattern: /\bWebSocket\b/g },
  { rule: 'EventSource', pattern: /\bEventSource\b/g },
  { rule: 'sendBeacon', pattern: /\bsendBeacon\b/g },
  { rule: 'importScripts', pattern: /\bimportScripts\s*\(/g },
  { rule: 'new Function', pattern: /\bnew\s+Function\s*\(/g },
  { rule: 'eval', pattern: /(?<![\w$.])eval\s*\(/g },
];

const URL_LITERAL = /\b(?:https?|wss?):\/\/[^\s'"`<>)\\]*/g;
const SCANNED_EXTENSIONS = ['.js', '.mjs', '.html', '.css'];
const CONTEXT_CHARS = 40;
const ALLOWED_URLS: readonly string[] = [...HOST_ORIGINS, ...NAMESPACE_URIS, ...DISPLAY_URLS];

export function isAllowedUrl(url: string): boolean {
  return ALLOWED_URLS.some((ok) => url === ok || url.startsWith(`${ok}/`));
}

function position(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - before.lastIndexOf('\n') };
}

function excerpt(source: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT_CHARS);
  return source.slice(start, index + length + CONTEXT_CHARS).replace(/\s+/g, ' ');
}

export function scanSource(file: string, source: string): Violation[] {
  const found: Violation[] = [];
  const record = (rule: string, match: string, index: number): void => {
    found.push({
      file,
      rule,
      match,
      ...position(source, index),
      context: excerpt(source, index, match.length),
    });
  };
  for (const { rule, pattern } of BANNED) {
    for (const m of source.matchAll(pattern)) record(rule, m[0], m.index);
  }
  for (const m of source.matchAll(URL_LITERAL)) {
    if (!isAllowedUrl(m[0])) record('absolute-url', m[0], m.index);
  }
  return found;
}

export function scanDist(distDir: string): Violation[] {
  return listFiles(distDir)
    .filter((f) => SCANNED_EXTENSIONS.some((ext) => f.endsWith(ext)))
    .flatMap((f) => scanSource(f, readFileSync(join(distDir, f), 'utf8')));
}

if (isMain(import.meta.url)) {
  const dist = 'dist';
  if (!existsSync(dist)) {
    console.error('verify:offline — dist/ not found; run the build first');
    process.exit(1);
  }
  const violations = scanDist(dist);
  if (violations.length > 0) {
    console.error(`verify:offline — ${violations.length} violation(s):`);
    for (const v of violations) {
      console.error(`  dist/${v.file}:${v.line}:${v.column}  [${v.rule}]  ${v.match}`);
      console.error(`      … ${v.context} …`);
    }
    process.exit(1);
  }
  console.log('verify:offline — OK (no network-capable code, no remote URLs)');
}
