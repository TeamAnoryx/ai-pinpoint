/**
 * Fixture tooling (ADAPTERS.md §9–§10). Never commits real conversation text.
 *
 *   pnpm fixture:capture --synth
 *     Regenerate the synthetic fixtures in tests/fixtures/<host>/ from tests/support/fixtures.
 *
 *   pnpm fixture:capture --scrub <captured.html> --out <fixture.html>
 *     Take an outerHTML capture from devtools and replace every text node and every
 *     attribute that can carry user content (aria-label, title, alt, href, value, placeholder)
 *     with deterministic placeholder words of the same length. Structure, tags, ids, and
 *     data-* attributes are kept; scripts and styles are dropped.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { allFixtures } from '../tests/support/fixtures/synth';
import { isMain } from './cli';

export const FIXTURE_DIR = join(import.meta.dirname, '..', 'tests', 'fixtures');

const CONTENT_ATTRS = ['aria-label', 'title', 'alt', 'href', 'value', 'placeholder', 'aria-description'];
const FILLER = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';

function placeholder(length: number, seed: number): string {
  let out = '';
  let i = seed % FILLER.length;
  while (out.length < length) {
    out += FILLER[i % FILLER.length];
    i++;
  }
  return out.slice(0, length);
}

export function scrub(html: string): string {
  const dom = new JSDOM(html);
  const { document, NodeFilter } = dom.window;
  for (const el of document.querySelectorAll('script, style, link, noscript')) el.remove();
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  let seed = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue ?? '';
    if (raw.trim().length === 0) continue;
    n.nodeValue = raw.replace(/\S+/g, (w) => placeholder(w.length, seed++));
  }
  for (const el of document.querySelectorAll('*')) {
    for (const attr of CONTENT_ATTRS) {
      const value = el.getAttribute(attr);
      if (value !== null) el.setAttribute(attr, attr === 'href' ? '#' : placeholder(value.length, seed++));
    }
  }
  document.title = 'Fixture thread';
  return `<!doctype html>\n${document.documentElement.outerHTML}\n`;
}

export function writeSynthetic(dir = FIXTURE_DIR): string[] {
  const written: string[] = [];
  for (const f of allFixtures()) {
    const file = join(dir, f.host, `${f.name}.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, f.html);
    written.push(file);
  }
  return written;
}

function main(argv: string[]): number {
  if (argv.includes('--synth')) {
    for (const file of writeSynthetic()) console.log(`wrote ${file}`);
    return 0;
  }
  const inIdx = argv.indexOf('--scrub');
  const outIdx = argv.indexOf('--out');
  const input = inIdx >= 0 ? argv[inIdx + 1] : undefined;
  const output = outIdx >= 0 ? argv[outIdx + 1] : undefined;
  if (!input || !output) {
    console.error('usage: fixture:capture --synth | --scrub <captured.html> --out <fixture.html>');
    return 2;
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, scrub(readFileSync(input, 'utf8')));
  console.log(`wrote scrubbed fixture ${output}`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
