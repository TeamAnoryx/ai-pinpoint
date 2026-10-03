import { STREAM_SAMPLE_MS, STREAM_TIMEOUT_MS } from '@shared/constants';
import { createChatgptAdapter } from '@content/adapters/chatgpt';
import { createClaudeAdapter } from '@content/adapters/claude';
import { createGeminiAdapter } from '@content/adapters/gemini';
import { createGenericAdapter } from '@content/adapters/generic';
import type { HostAdapter } from '@content/adapters/types';
import { baseOf, contentHash, createIdentity, nativeHash, type PinTarget } from '@content/core/identity';
import { fixture } from '../../support/fixtures/synth';
import { loadFixture, resetDocument } from '../../support/fixtures/load';

let clock = 0;
const now = (): number => clock;

afterEach(resetDocument);

function hashesOf(adapter: HostAdapter): string[] {
  const id = createIdentity(adapter);
  const nodes = adapter.listMessageNodes();
  id.rebuildIndex(nodes);
  return nodes.map((n) => id.meta(n)!.hash);
}

function pinOf(id: ReturnType<typeof createIdentity>, node: HTMLElement): PinTarget {
  const d = id.describe(node, 140)!;
  return { targetHash: d.targetHash, nativeId: d.nativeId, role: d.role, snippet: d.snippet, ordinal: d.ordinal };
}

/** Claude fixture with native ids stripped, so identity runs on content hashes. */
function contentOnlyClaude(name: string): HostAdapter {
  loadFixture(fixture('claude', name));
  for (const el of document.querySelectorAll('[data-turn-key]')) el.removeAttribute('data-turn-key');
  const adapter = createClaudeAdapter({ now });
  // Roles come from the body test ids once data-turn-key is gone.
  return adapter;
}

describe('hash format', () => {
  test('native and content forms', () => {
    expect(nativeHash('abc')).toMatch(/^n:[0-9a-z]+$/);
    const h = contentHash('user', 'Hello world', 5);
    expect(h).toMatch(/^c:[0-9a-z]+:5$/);
    expect(baseOf(h)).toBe(h.slice(0, h.lastIndexOf(':')));
    expect(baseOf(nativeHash('abc'))).toBe(nativeHash('abc'));
  });

  test('ordinal is bucketed', () => {
    expect(contentHash('user', 'x', 4096)).toBe(contentHash('user', 'x', 0));
  });
});

describe('hash stability', () => {
  test.each(['gemini', 'chatgpt', 'claude'] as const)('%s: same fixture parsed twice → identical hashes', (host) => {
    const f = fixture(host, 'short-thread');
    loadFixture(f);
    const factory = { gemini: createGeminiAdapter, chatgpt: createChatgptAdapter, claude: createClaudeAdapter }[host];
    const make = (): HostAdapter => factory({ now });
    const first = hashesOf(make());
    loadFixture(f);
    expect(hashesOf(make())).toEqual(first);
  });

  test('hover-only buttons, expanded reasoning and loaded artifacts do not change content hashes', () => {
    const adapter = contentOnlyClaude('artifact');
    const before = hashesOf(adapter);
    const node = adapter.listMessageNodes()[1]!;
    const hoverRow = document.createElement('div');
    hoverRow.append(document.createElement('button'), document.createElement('button'));
    node.append(hoverRow);
    const toggle = node.querySelector('[aria-expanded]')!;
    toggle.setAttribute('aria-expanded', 'true');
    const thinking = document.createElement('div');
    thinking.textContent = 'expanded reasoning text';
    toggle.parentElement!.after(thinking);
    const card = node.querySelector('[data-sheet-kind]')!;
    card.append(document.createTextNode('artifact finished loading'));
    expect(hashesOf(adapter)).toEqual(before);
  });
});

describe('hash distinctness', () => {
  test('shared 256-char prefix but different length or tail → different hashes', () => {
    const prefix = 'a'.repeat(300);
    expect(contentHash('assistant', `${prefix} end one`, 1)).not.toBe(contentHash('assistant', `${prefix} end two`, 1));
    expect(contentHash('assistant', `${prefix} tail`, 1)).not.toBe(contentHash('assistant', `${prefix} tail tail`, 1));
    expect(contentHash('user', 'same', 1)).not.toBe(contentHash('assistant', 'same', 1));
  });
});

describe('resolution', () => {
  test('exact hit', () => {
    const adapter = contentOnlyClaude('short-thread');
    const id = createIdentity(adapter);
    const nodes = adapter.listMessageNodes();
    id.rebuildIndex(nodes);
    const r = id.resolve(pinOf(id, nodes[2]!));
    expect(r?.node).toBe(nodes[2]);
    expect(r?.via).toBe('exact');
  });

  test('native id hit repairs a stale hash', () => {
    loadFixture(fixture('claude', 'short-thread'));
    const adapter = createClaudeAdapter({ now });
    const id = createIdentity(adapter);
    const nodes = adapter.listMessageNodes();
    id.rebuildIndex(nodes);
    const pin = { ...pinOf(id, nodes[1]!), targetHash: 'n:stale' };
    const r = id.resolve(pin)!;
    expect(r.node).toBe(nodes[1]);
    expect(r.via).toBe('native');
    expect(id.needsRepair(pin, r)).toBe(true);
  });

  test('ordinal drift: 3 messages inserted above → resolves via hash-without-ordinal and repairs', () => {
    const adapter = contentOnlyClaude('short-thread');
    const id = createIdentity(adapter);
    let nodes = adapter.listMessageNodes();
    id.rebuildIndex(nodes);
    const target = nodes[3]!;
    const pin = pinOf(id, target);

    const sizer = document.querySelector('[data-testid="transcript-sizer"]')!;
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.setAttribute('data-testid', 'transcript-row');
      const article = document.createElement('div');
      article.setAttribute('role', 'article');
      const body = document.createElement('div');
      body.setAttribute('data-testid', 'user-message');
      body.textContent = `Inserted older message ${i} with distinct words`;
      article.append(body);
      row.append(article);
      sizer.prepend(row);
    }
    nodes = adapter.listMessageNodes();
    id.rebuildIndex(nodes);
    const r = id.resolve(pin)!;
    expect(r.node).toBe(target);
    expect(r.via).toBe('base');
    expect(id.needsRepair(pin, r)).toBe(true);
    expect(r.meta.hash).not.toBe(pin.targetHash);
  });

  test('duplicate text: three identical "yes" → nearest ordinal, flagged duplicate', () => {
    const main = document.createElement('main');
    for (let i = 0; i < 6; i++) {
      const art = document.createElement('article');
      art.textContent = i % 2 === 0 ? 'yes' : `Assistant reply number ${i} that is long enough to count here.`;
      main.append(art);
    }
    document.body.append(main);
    const adapter: HostAdapter = {
      ...createGenericAdapter(),
      listMessageNodes: () => [...document.querySelectorAll<HTMLElement>('article')],
      getRole: (n) => ([...document.querySelectorAll('article')].indexOf(n) % 2 === 0 ? 'user' : 'assistant'),
    };
    const id = createIdentity(adapter);
    const nodes = adapter.listMessageNodes();
    id.rebuildIndex(nodes);
    // Pin the "yes" at ordinal 2, then it shifts: the stored hash's ordinal no longer exists.
    const pin = { ...pinOf(id, nodes[2]!), targetHash: `${id.meta(nodes[2]!)!.base}:7`, ordinal: 3 };
    const r = id.resolve(pin)!;
    expect(r.via).toBe('base-nearest');
    expect(r.node).toBe(nodes[2]);
    expect(r.duplicate).toBe(true);
    expect(id.isDuplicate(pin)).toBe(true);
  });

  test('snippet similarity ≥ threshold resolves when hashes are all stale', () => {
    const adapter = contentOnlyClaude('short-thread');
    const id = createIdentity(adapter);
    const nodes = adapter.listMessageNodes();
    id.rebuildIndex(nodes);
    const pin = { ...pinOf(id, nodes[1]!), targetHash: 'c:stale:1' };
    const r = id.resolve(pin)!;
    expect(r.node).toBe(nodes[1]);
    expect(r.via).toBe('similarity');
  });

  test('no match → null (caller recovers)', () => {
    const adapter = contentOnlyClaude('short-thread');
    const id = createIdentity(adapter);
    id.rebuildIndex(adapter.listMessageNodes());
    expect(
      id.resolve({ targetHash: 'c:none:1', nativeId: null, role: 'user', snippet: 'zzz qqq unrelated', ordinal: 0 }),
    ).toBeNull();
  });
});

describe('streaming', () => {
  function reconcile(adapter: HostAdapter, id: ReturnType<typeof createIdentity>): HTMLElement[] {
    const nodes = adapter.listMessageNodes();
    const pending = new Set(nodes.filter((n) => adapter.isStreaming?.(n)));
    id.rebuildIndex(nodes, pending);
    return nodes;
  }

  test('a node is indexed only after its text stabilises', () => {
    loadFixture(fixture('gemini', 'short-thread'));
    clock = 0;
    const adapter = createGeminiAdapter({ now });
    const id = createIdentity(adapter);
    let nodes = reconcile(adapter, id);
    const tail = nodes[3]!;
    expect(id.meta(tail)).toBeUndefined();
    tail.querySelector('message-content p')!.append(' more streamed words');
    clock += STREAM_SAMPLE_MS;
    nodes = reconcile(adapter, id);
    expect(id.meta(tail)).toBeUndefined();
    clock += STREAM_SAMPLE_MS;
    nodes = reconcile(adapter, id);
    expect(id.meta(tail)?.text).toContain('more streamed words');
    expect(nodes).toHaveLength(4);
  });

  test('offline cut: a node that never stabilises is indexed after STREAM_TIMEOUT_MS', () => {
    loadFixture(fixture('gemini', 'short-thread'));
    clock = 0;
    const adapter = createGeminiAdapter({ now });
    const id = createIdentity(adapter);
    const tail = reconcile(adapter, id)[3]!;
    for (let t = STREAM_SAMPLE_MS; t < STREAM_TIMEOUT_MS; t += STREAM_SAMPLE_MS) {
      clock = t;
      tail.querySelector('message-content p')!.append(` w${t}`);
      reconcile(adapter, id);
      expect(id.meta(tail)).toBeUndefined();
    }
    clock = STREAM_TIMEOUT_MS;
    tail.querySelector('message-content p')!.append(' last');
    reconcile(adapter, id);
    expect(id.meta(tail)).toBeDefined();
  });
});
