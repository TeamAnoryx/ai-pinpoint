/**
 * Prints which selector tiers resolve against a fixture (ADAPTERS.md §10 step 2).
 *
 *   pnpm adapter:probe --fixture tests/fixtures/claude/short-thread.html [--url https://claude.ai/chat/<id>]
 *
 * The host is inferred from the fixture directory name when --url is omitted.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { JSDOM } from 'jsdom';
import { isMain } from './cli';

const DEFAULT_URLS: Record<string, string> = {
  gemini: 'https://gemini.google.com/app/c0ffee12ab34cd56',
  chatgpt: 'https://chatgpt.com/c/00000000-0000-4000-a000-000000000000',
  claude: 'https://claude.ai/chat/00000000-0000-4000-a000-000000000000',
};

const GLOBALS = ['window', 'document', 'location', 'Node', 'NodeFilter', 'Element', 'HTMLElement', 'getComputedStyle'] as const;

export async function probeFixture(file: string, url?: string): Promise<Record<string, unknown>> {
  const host = basename(dirname(file));
  const dom = new JSDOM(readFileSync(file, 'utf8'), { url: url ?? DEFAULT_URLS[host] ?? 'https://localhost/' });
  const g = globalThis as Record<string, unknown>;
  for (const key of GLOBALS) {
    const value = (dom.window as unknown as Record<string, unknown>)[key];
    g[key] = typeof value === 'function' && key === 'getComputedStyle' ? value.bind(dom.window) : value;
  }
  g['performance'] ??= dom.window.performance;
  g['__DEV__'] = false;

  const { resolve, isFallback } = await import('../src/content/adapters/registry');
  const sets = {
    gemini: (await import('../src/content/adapters/gemini')).geminiSelectors,
    chatgpt: (await import('../src/content/adapters/chatgpt')).chatgptSelectors,
    claude: (await import('../src/content/adapters/claude')).claudeSelectors,
    generic: (await import('../src/content/adapters/generic')).genericSelectors,
  };
  const adapter = resolve(dom.window.location);
  const probe = adapter.probe();
  const nodes = adapter.listMessageNodes();
  return {
    adapter: adapter.id,
    fallback: isFallback(adapter),
    probe,
    roles: nodes.map((n) => adapter.getRole(n)),
    tiers: sets[adapter.id].report(),
  };
}

async function main(argv: string[]): Promise<number> {
  const idx = argv.indexOf('--fixture');
  const file = idx >= 0 ? argv[idx + 1] : undefined;
  const urlIdx = argv.indexOf('--url');
  if (!file) {
    console.error('usage: adapter:probe --fixture <file.html> [--url <page url>]');
    return 2;
  }
  console.log(JSON.stringify(await probeFixture(file, urlIdx >= 0 ? argv[urlIdx + 1] : undefined), null, 2));
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
