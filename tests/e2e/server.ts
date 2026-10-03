/**
 * Local fixture server for E2E (TESTING.md §4). Serves host-shaped pages generated from the
 * synthetic fixtures at http://localhost:<port>/<hostId>/<thread path>?n=&virtual=&stream=.
 * No outbound network: everything is generated in-process.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture, type FixtureHost } from '../support/fixtures/synth';

export const E2E_PORT = Number(process.env['E2E_PORT'] ?? 4517);
const HOSTS: readonly FixtureHost[] = ['gemini', 'chatgpt', 'claude'];
const RUNTIME = readFileSync(join(import.meta.dirname, 'page-runtime.js'), 'utf8');

/** Marks the scroll container and row elements the page runtime virtualises. */
const VIRTUAL_MARKS: Record<FixtureHost, [RegExp, string][]> = {
  claude: [
    [/data-autoscroll-container="true"/, 'data-autoscroll-container="true" data-e2e-scroll'],
    [/data-testid="transcript-sizer"/, 'data-testid="transcript-sizer" data-e2e-rows'],
    [/data-testid="transcript-row"/g, 'data-testid="transcript-row" data-e2e-row'],
  ],
  chatgpt: [
    [/class="scroll-root"/, 'class="scroll-root" data-e2e-scroll'],
    [/id="thread"/, 'id="thread" data-e2e-rows'],
    [/<section data-testid=/g, '<section data-e2e-row data-testid='],
  ],
  gemini: [
    [/<infinite-scroller /, '<infinite-scroller data-e2e-scroll data-e2e-rows '],
    [/<div class="conversation-container"/g, '<div data-e2e-row class="conversation-container"'],
  ],
};

export function renderPage(url: URL): string | null {
  const [, host, ...rest] = url.pathname.split('/');
  if (!HOSTS.includes(host as FixtureHost)) return null;
  const h = host as FixtureHost;
  const n = Math.min(1000, Math.max(2, Number(url.searchParams.get('n') ?? 20)));
  const stream = url.searchParams.get('stream');
  const f = buildFixture(h, 'e2e', { messages: n, streaming: stream !== null, noActions: url.searchParams.get('rows') === '0' });
  // Distinct text per thread path so an SPA switch really changes the conversation.
  const tag = rest.join('/').replace(/[^a-z0-9]/gi, '').slice(-8) || 'root';
  let html = f.html.replace(/Fixture (user|assistant) message/g, `Thread ${tag} $1 message`);
  if (url.searchParams.get('virtual') === '1') {
    for (const [re, rep] of VIRTUAL_MARKS[h]) html = html.replace(re, rep);
  }
  return html.replace('</body>', '<script src="/runtime.js"></script>\n</body>');
}

export function startServer(port = E2E_PORT): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname === '/runtime.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(RUNTIME);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === '/' || url.pathname === '/blank') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>blank</title><p>blank</p>');
      return;
    }
    const page = renderPage(url);
    if (!page) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  server.listen(port);
  return server;
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  startServer();
  console.log(`fixture server on http://localhost:${E2E_PORT}`);
}
