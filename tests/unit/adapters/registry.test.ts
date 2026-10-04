import { createGenericAdapter } from '@content/adapters/generic';
import { findAdapter, isFallback, resolve, withFallback } from '@content/adapters/registry';
import { claudeAdapter } from '@content/adapters/claude';
import { scrub } from '../../../scripts/fixture-capture';
import { fixture } from '../../support/fixtures/synth';
import { loadFixture, loc, resetDocument } from '../../support/fixtures/load';

const long = (n: number): string => `Generic message number ${n} with enough words to count as a real turn.`;

function articles(count: number, wrap = 'article'): void {
  const main = document.createElement('main');
  for (let i = 0; i < count; i++) {
    const el = document.createElement(wrap);
    const p = document.createElement('p');
    p.textContent = long(i);
    el.append(p);
    main.append(el);
  }
  document.body.append(main);
}

afterEach(resetDocument);

describe('registry.resolve', () => {
  test('returns the real adapter when its probe finds messages', () => {
    loadFixture(fixture('claude', 'short-thread'));
    const a = resolve(loc('https://claude.ai/chat/x'));
    expect(a).toBe(claudeAdapter);
    expect(isFallback(a)).toBe(false);
  });

  test('keeps the real adapter on an empty new chat (nothing to fall back to)', () => {
    expect(resolve(loc('https://claude.ai/new'))).toBe(claudeAdapter);
  });

  test('falls back to generic DOM discovery but keeps host id and thread scoping', () => {
    articles(4);
    history.replaceState(null, '', '/chat/11111111-2222-4333-8444-555555555555');
    const a = resolve(loc('https://claude.ai/chat/11111111-2222-4333-8444-555555555555'));
    expect(isFallback(a)).toBe(true);
    expect(a.id).toBe('claude');
    expect(a.listMessageNodes()).toHaveLength(4);
    expect(a.getThreadId(loc('https://claude.ai/chat/11111111-2222-4333-8444-555555555555'))).toBe(
      'claude:11111111-2222-4333-8444-555555555555',
    );
    expect(a.probe().threadId).toBe(true);
  });

  test('unknown origin gets the generic adapter', () => {
    expect(findAdapter(loc('https://example.test/'))).toBeNull();
    expect(resolve(loc('https://example.test/')).id).toBe('generic');
  });

  test('withFallback forwards the primary title', () => {
    document.title = 'Some chat - Claude';
    const a = withFallback(claudeAdapter, createGenericAdapter());
    expect(a.getThreadTitle?.()).toBe('Some chat');
  });
});

describe('generic adapter', () => {
  test('finds articles with enough text and alternates roles', () => {
    articles(3);
    const short = document.createElement('article');
    short.textContent = 'tiny';
    document.querySelector('main')!.append(short);
    const g = createGenericAdapter();
    const nodes = g.listMessageNodes();
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n) => g.getRole(n))).toEqual(['user', 'assistant', 'user']);
    expect(g.getNativeId(nodes[0]!)).toBeNull();
    expect(g.getText(nodes[1]!)).toBe(long(1));
  });

  test('clusters repeated structure when no semantic containers exist', () => {
    articles(4, 'div');
    expect(createGenericAdapter().listMessageNodes()).toHaveLength(4);
  });

  test('thread id only when the last path segment looks like an id', () => {
    const g = createGenericAdapter();
    expect(g.getThreadId(loc('https://example.test/t/0a1b2c3d4e'))).toBe('generic:0a1b2c3d4e');
    expect(g.getThreadId(loc('https://example.test/settings'))).toBeNull();
  });

  test('mount: button row when present, null otherwise', () => {
    articles(3);
    const g = createGenericAdapter();
    const node = g.listMessageNodes()[0]!;
    expect(g.getActionBarMount(node)).toBeNull();
    const row = document.createElement('div');
    row.append(document.createElement('button'), document.createElement('button'));
    node.append(row);
    expect(g.getActionBarMount(node)?.container).toBe(row);
  });
});

describe('fixture:capture --scrub', () => {
  test('replaces text and content attributes, keeps structure and data attributes', () => {
    const out = scrub(
      '<html><head><title>Secret title</title><script>x()</script></head><body><div data-testid="user-message" aria-label="private label"><p>my private words</p><a href="https://x.test/p">link</a></div></body></html>',
    );
    expect(out).not.toMatch(/private|Secret|x\(\)|x\.test/);
    expect(out).toContain('data-testid="user-message"');
    expect(out).toContain('<p>');
    expect(out).toContain('href="#"');
  });
});
