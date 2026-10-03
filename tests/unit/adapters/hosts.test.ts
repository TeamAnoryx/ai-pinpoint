/**
 * Every HostAdapter method against every fixture for its host (TESTING.md §3, A1–A10).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STREAM_SAMPLE_MS } from '@shared/constants';
import { createChatgptAdapter, chatgptSelectors } from '@content/adapters/chatgpt';
import { createClaudeAdapter, claudeSelectors } from '@content/adapters/claude';
import { createGeminiAdapter, geminiSelectors } from '@content/adapters/gemini';
import type { AdapterOptions } from '@content/adapters/base';
import type { SelectorSet } from '@content/adapters/selectors';
import type { HostAdapter } from '@content/adapters/types';
import { allFixtures, fixture, type FixtureHost } from '../../support/fixtures/synth';
import { loadFixture, loc, resetDocument } from '../../support/fixtures/load';

const FACTORIES: Record<FixtureHost, (o: AdapterOptions) => HostAdapter> = {
  gemini: createGeminiAdapter,
  chatgpt: createChatgptAdapter,
  claude: createClaudeAdapter,
};
const SELECTORS: Record<FixtureHost, SelectorSet<string>> = {
  gemini: geminiSelectors as SelectorSet<string>,
  chatgpt: chatgptSelectors as SelectorSet<string>,
  claude: claudeSelectors as SelectorSet<string>,
};
const ORIGINS: Record<FixtureHost, string> = {
  gemini: 'https://gemini.google.com',
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
};
const NEW_CHAT: Record<FixtureHost, string> = { gemini: '/app', chatgpt: '/', claude: '/new' };

const ACTION_WORDS = /\b(copy|edit|regenerate|retry|share|good response|bad response|thought process)\b/i;

let clock = 0;
const now = (): number => clock;

afterEach(resetDocument);

describe.each(allFixtures().map((f) => [`${f.host}/${f.name}`, f] as const))('%s', (_label, f) => {
  let adapter: HostAdapter;
  beforeEach(() => {
    clock = 0;
    loadFixture(f);
    adapter = FACTORIES[f.host]({ now });
  });

  test('committed fixture file matches the generator', () => {
    const file = join(import.meta.dirname, '..', '..', 'fixtures', f.host, `${f.name}.html`);
    expect(readFileSync(file, 'utf8')).toBe(f.html);
  });

  test('A1 observer root is connected', () => {
    expect(adapter.getObserverRoot()?.isConnected).toBe(true);
  });

  test('A2 scroll container resolves (and scrolls on long threads)', () => {
    const sc = adapter.getScrollContainer();
    expect(sc).not.toBeNull();
    if (f.scrolls) expect(sc!.scrollHeight).toBeGreaterThan(sc!.clientHeight);
  });

  test('A3 message nodes: count, order, no duplicates, no composer/sidebar', () => {
    const nodes = adapter.listMessageNodes();
    expect(nodes).toHaveLength(f.messages.length);
    expect(new Set(nodes).size).toBe(nodes.length);
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1]!.compareDocumentPosition(nodes[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const n of nodes) {
      expect(n.querySelector('[contenteditable]')).toBeNull();
      expect(n.closest('nav')).toBeNull();
    }
  });

  test('A4 roles', () => {
    expect(adapter.listMessageNodes().map((n) => adapter.getRole(n))).toEqual(f.messages.map((m) => m.role));
  });

  test('A5 native ids are present and stable', () => {
    const nodes = adapter.listMessageNodes();
    const first = nodes.map((n) => adapter.getNativeId(n));
    expect(first).toEqual(f.messages.map((m) => m.nativeId));
    expect(nodes.map((n) => adapter.getNativeId(n))).toEqual(first);
  });

  test('A6 text equals expected and carries no host chrome', () => {
    const texts = adapter.listMessageNodes().map((n) => adapter.getText(n));
    expect(texts).toEqual(f.messages.map((m) => m.text));
    for (const t of texts) {
      expect(t).not.toMatch(ACTION_WORDS);
      expect(t).not.toMatch(/icon|said:|You said|data-pinpoint/);
    }
  });

  test('A7 action-bar mount', () => {
    for (const [i, node] of adapter.listMessageNodes().entries()) {
      const mp = adapter.getActionBarMount(node);
      const expectsRow = f.hasActionRows && i !== f.streamingIndex;
      if (!expectsRow) {
        expect(mp).toBeNull();
        continue;
      }
      expect(mp).not.toBeNull();
      expect(mp!.container.querySelectorAll('button, [role="button"]').length).toBeGreaterThanOrEqual(2);
      expect(mp!.container.querySelector('pre, code')).toBeNull();
    }
  });

  test('A8 thread id for the fixture URL; null on a new chat', () => {
    expect(adapter.getThreadId(loc(`${ORIGINS[f.host]}${f.path}`))).toBe(f.threadId);
    expect(adapter.getThreadId(loc(`${ORIGINS[f.host]}${NEW_CHAT[f.host]}`))).toBeNull();
    expect(adapter.getThreadTitle?.()).toBe(f.title);
  });

  test('A9 only the streaming node streams once the sampler has settled', () => {
    const nodes = adapter.listMessageNodes();
    nodes.forEach((n) => adapter.isStreaming?.(n));
    clock += STREAM_SAMPLE_MS;
    const streaming = nodes.map((n) => adapter.isStreaming?.(n) ?? false);
    expect(streaming).toEqual(nodes.map((_, i) => i === f.streamingIndex));
  });

  test('A10 probe', () => {
    const probe = adapter.probe();
    expect(probe.messageNodes).toBe(f.messages.length);
    if (f.name === 'short-thread') {
      expect(probe).toEqual({
        scrollContainer: true,
        observerRoot: true,
        messageNodes: f.messages.length,
        actionBarMounts: f.messages.length,
        threadId: true,
        nativeIds: true,
      });
    }
    if (f.name === 'no-action-rows') expect(probe.actionBarMounts).toBe(0);
  });

  test('matches its own origin only', () => {
    expect(adapter.matches(loc(`${ORIGINS[f.host]}/`))).toBe(true);
    for (const [host, origin] of Object.entries(ORIGINS)) {
      if (host !== f.host) expect(adapter.matches(loc(`${origin}/`))).toBe(false);
    }
  });
});

describe('tier reporting', () => {
  test.each(['gemini', 'chatgpt', 'claude'] as const)('%s happy path never relies on tier 4 alone', (host) => {
    const f = fixture(host, 'short-thread');
    loadFixture(f);
    const adapter = FACTORIES[host]({ now });
    for (const n of adapter.listMessageNodes()) {
      adapter.getText(n);
      adapter.getActionBarMount(n);
    }
    adapter.probe();
    for (const tier of Object.values(SELECTORS[host].report())) expect(tier).not.toBe(4);
  });
});

describe('claude artifact and reasoning invariance', () => {
  test('text is identical with reasoning collapsed vs expanded, and with the artifact card removed', () => {
    const f = fixture('claude', 'artifact');
    loadFixture(f);
    const adapter = createClaudeAdapter({ now });
    const node = adapter.listMessageNodes()[1]!;
    const collapsed = adapter.getText(node);
    expect(collapsed).toBe(f.messages[1]!.text);

    const toggle = node.querySelector('[aria-expanded]')!;
    toggle.setAttribute('aria-expanded', 'true');
    const reasoning = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = 'reasoning words that must never reach the hash';
    reasoning.append(p);
    toggle.parentElement!.after(reasoning);
    expect(adapter.getText(node)).toBe(collapsed);

    node.querySelector('[data-sheet-kind]')!.remove();
    expect(adapter.getText(node)).toBe(collapsed);
  });
});

describe('chatgpt branches', () => {
  test('every branch message has a distinct native id and the counter row is still the mount', () => {
    const f = fixture('chatgpt', 'branched');
    loadFixture(f);
    const adapter = createChatgptAdapter({ now });
    const nodes = adapter.listMessageNodes();
    const ids = nodes.map((n) => adapter.getNativeId(n));
    expect(new Set(ids).size).toBe(ids.length);
    const mp = adapter.getActionBarMount(nodes[2]!);
    expect(mp?.container.textContent).toContain('2/3');
  });
});

describe('gemini immersive panel', () => {
  test('side panel is not a message and its buttons are not a mount', () => {
    const f = fixture('gemini', 'immersive');
    loadFixture(f);
    const adapter = createGeminiAdapter({ now });
    const nodes = adapter.listMessageNodes();
    expect(nodes.some((n) => n.closest('immersive-panel'))).toBe(false);
    for (const n of nodes) expect(adapter.getActionBarMount(n)?.container.closest('immersive-panel')).toBeFalsy();
  });
});

describe('requestOlderMessages', () => {
  test('scrolls up and reports whether more nodes mounted', async () => {
    vi.useFakeTimers();
    try {
      loadFixture(fixture('claude', 'long-thread'));
      const adapter = createClaudeAdapter({ now });
      const sc = adapter.getScrollContainer()!;
      sc.scrollTop = 0;
      await expect(adapter.requestOlderMessages!()).resolves.toBe(false);
      sc.scrollTop = 2000;
      const grew = adapter.requestOlderMessages!();
      const extra = sc.querySelector('[data-testid="transcript-row"]')!.cloneNode(true) as HTMLElement;
      extra.querySelector('[data-turn-key]')!.setAttribute('data-turn-key', 'older');
      sc.querySelector('[data-testid="transcript-sizer"]')!.prepend(extra);
      vi.runAllTimers();
      await expect(grew).resolves.toBe(true);
      expect(sc.scrollTop).toBeLessThan(2000);
    } finally {
      vi.useRealTimers();
    }
  });
});
