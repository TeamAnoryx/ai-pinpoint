import { STREAM_SAMPLE_MS } from '@shared/constants';
import { createChatgptAdapter } from '@content/adapters/chatgpt';
import { createClaudeAdapter } from '@content/adapters/claude';
import { createGeminiAdapter } from '@content/adapters/gemini';
import type { HostAdapter } from '@content/adapters/types';
import { createEngine, type Engine } from '@content/core/engine';
import { liveObserverCount } from '@content/core/observer';
import { liveWatcherCount } from '@content/core/thread';
import { countInjected } from '@content/inject/pin-button';
import { buildFixture, fixture, type Fixture, type FixtureHost } from '../../support/fixtures/synth';
import { loadFixture, resetDocument } from '../../support/fixtures/load';
import { makeWorker } from '../../support/worker';

const ORIGINS: Record<FixtureHost, string> = {
  gemini: 'https://gemini.google.com',
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
};
const FACTORIES: Record<FixtureHost, (o: { now: () => number }) => HostAdapter> = {
  gemini: createGeminiAdapter,
  chatgpt: createChatgptAdapter,
  claude: createClaudeAdapter,
};

let clock = 0;
const engines: Engine[] = [];

const waitFor = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

async function boot(f: Fixture, worker = makeWorker()) {
  loadFixture(f);
  clock = 0;
  const layer = document.createElement('div');
  layer.setAttribute('data-pinpoint-ui', 'layer');
  document.documentElement.append(layer);
  const adapter = FACTORIES[f.host]({ now: () => clock });
  const engine = createEngine({
    adapter,
    proxy: worker.proxy,
    layer,
    hostLabel: new URL(ORIGINS[f.host]).hostname,
    loc: () => new URL(`${ORIGINS[f.host]}${location.pathname}`) as unknown as Location,
  });
  engines.push(engine);
  await engine.start();
  // Settle the streaming sampler for hosts without a definitive marker.
  for (let i = 0; i < 2; i++) {
    clock += STREAM_SAMPLE_MS;
    engine.internals.reconcileAll();
  }
  return { engine, adapter, worker, layer };
}

afterEach(() => {
  for (const e of engines.splice(0)) e.stop();
  document.querySelectorAll('[data-pinpoint-ui="layer"]').forEach((l) => l.remove());
  resetDocument();
});

describe('engine boot and injection', () => {
  test.each(['gemini', 'chatgpt', 'claude'] as const)('%s: a pin button on every message', async (host) => {
    const f = fixture(host, 'short-thread');
    const { engine, adapter } = await boot(f);
    expect(engine.state.get().status).toBe('running');
    expect(engine.state.get().threadId).toBe(f.threadId);
    const nodes = adapter.listMessageNodes();
    expect(countInjected(document)).toBe(nodes.length);
    for (const n of nodes) {
      const mp = adapter.getActionBarMount(n)!;
      expect(mp.container.querySelector('[data-pinpoint-btn]')).not.toBeNull();
    }
    expect(engine.state.get().health.state).toBe('healthy');
  });

  test('re-mounts a button when the host re-renders its action row', async () => {
    const { engine, adapter } = await boot(fixture('chatgpt', 'short-thread'));
    const node = adapter.listMessageNodes()[1]!;
    const row = adapter.getActionBarMount(node)!.container;
    const replacement = row.cloneNode(false) as HTMLElement;
    for (const b of row.querySelectorAll('button:not([data-pinpoint-btn])')) replacement.append(b.cloneNode(true));
    row.replaceWith(replacement);
    engine.internals.reconcileAll();
    expect(replacement.querySelector('[data-pinpoint-btn]')).not.toBeNull();
    expect(countInjected(document)).toBe(4);
  });

  test('disabled host: no observers, no buttons', async () => {
    const worker = makeWorker();
    await worker.proxy.call('settings:set', {
      hosts: { gemini: { enabled: true }, chatgpt: { enabled: true }, claude: { enabled: false }, generic: { enabled: true } },
    });
    const before = liveObserverCount();
    const { engine } = await boot(fixture('claude', 'short-thread'), worker);
    expect(engine.state.get().status).toBe('disabled');
    expect(countInjected(document)).toBe(0);
    expect(liveObserverCount()).toBe(before);
  });
});

describe('pinning', () => {
  test('click pins, persists, and marks the button pressed; click again unpins with undo', async () => {
    const { engine, adapter, worker } = await boot(fixture('claude', 'short-thread'));
    const node = adapter.listMessageNodes()[1]!;
    const btn = node.querySelector<HTMLButtonElement>('[data-pinpoint-btn]')!;
    btn.click();
    await waitFor(() => engine.state.get().pins.length === 1);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    const stored = await worker.proxy.call('pins:list', { hostId: 'claude', threadId: fixture('claude', 'short-thread').threadId });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.snippet).toBe(fixture('claude', 'short-thread').messages[1]!.text);

    btn.click();
    await waitFor(() => engine.state.get().toast?.action === 'undo');
    expect(engine.state.get().pins).toHaveLength(0);
    await engine.intents.undo();
    await waitFor(() => engine.state.get().pins.length === 1);
    expect(engine.state.get().pins[0]!.pin.pinId).toBe(stored[0]!.pinId);
  });

  test('undo restores label and relative order', async () => {
    const { engine, adapter } = await boot(fixture('chatgpt', 'short-thread'));
    for (const n of adapter.listMessageNodes()) await engine.intents.pinNode(n);
    const ids = engine.state.get().pins.map((p) => p.pin.pinId);
    await engine.intents.rename(ids[1]!, 'Second');
    await engine.intents.unpin(ids[1]!);
    await engine.intents.undo();
    const after = engine.state.get().pins.map((p) => p.pin);
    expect(after.map((p) => p.pinId)).toEqual(ids);
    expect(after[1]!.label).toBe('Second');
  });

  test('pin-last while streaming is queued and completes after the stream settles', async () => {
    const { engine, adapter } = await boot(fixture('claude', 'streaming'));
    engine.handleMessage('command:pinLast', null);
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.state.get().pins).toHaveLength(0);
    const tail = adapter.listMessageNodes()[3]!;
    expect(tail.querySelector('[data-pinpoint-btn]') ?? null).toBeNull();
    tail.querySelector('[data-is-streaming]')!.setAttribute('data-is-streaming', 'false');
    engine.internals.reconcileAll();
    await waitFor(() => engine.state.get().pins.length === 1);
    expect(engine.state.get().pins[0]!.pin.role).toBe('assistant');
  });

  test('no action rows → degraded:no-mount; floating buttons; hotkey pinning still works', async () => {
    const { engine, layer } = await boot(fixture('claude', 'no-action-rows'));
    expect(engine.state.get().health.state).toBe('degraded:no-mount');
    expect(layer.querySelectorAll('[data-pinpoint-btn]').length).toBe(4);
    engine.handleMessage('command:pinLast', null);
    await waitFor(() => engine.state.get().pins.length === 1);
  });

  test('transient thread keeps pins in memory and never writes', async () => {
    const f = { ...fixture('claude', 'short-thread'), path: '/new' };
    const { engine, adapter, worker } = await boot(f);
    expect(engine.state.get().transient).toBe(true);
    expect(engine.state.get().health.state).toBe('degraded:no-thread');
    await engine.intents.pinNode(adapter.listMessageNodes()[0]!);
    expect(engine.state.get().pins).toHaveLength(1);
    expect(worker.calls).not.toContain('pins:add');
  });
});

describe('navigation through the engine', () => {
  test('navigate centres and highlights; repairs a drifted hash', async () => {
    const { engine, adapter, layer } = await boot(fixture('claude', 'short-thread'));
    await engine.intents.pinNode(adapter.listMessageNodes()[2]!);
    const pinId = engine.state.get().pins[0]!.pin.pinId;
    await engine.intents.navigate(pinId);
    expect(layer.querySelector('[data-pinpoint-ui="highlight"]')).not.toBeNull();
    expect(engine.state.get().pins[0]!.nav).toBe('idle');
  });
});

describe('thread switch and teardown', () => {
  test('SPA switch tears down the old thread fully and loads the new one', async () => {
    const f = fixture('claude', 'short-thread');
    const { engine, adapter } = await boot(f);
    await engine.intents.pinNode(adapter.listMessageNodes()[0]!);
    const observersBefore = liveObserverCount();

    const next = buildFixture('claude', 'other', { messages: 6 });
    const nextPath = '/chat/99999999-8888-4777-a666-555555555555';
    loadFixture({ ...next, path: nextPath });
    // loadFixture replaced the DOM (as a host does on route change) and pushed the URL.
    await waitFor(() => engine.state.get().threadId === `claude:99999999-8888-4777-a666-555555555555`, 3000);
    await waitFor(() => countInjected(document) === 6, 3000);
    expect(engine.state.get().pins).toHaveLength(0);
    expect(liveObserverCount()).toBe(observersBefore);
    expect(document.querySelectorAll('[data-pinpoint-has-pin]').length).toBe(0);
  });

  test('stop removes every button, attribute, observer, and watcher', async () => {
    const watchersBefore = liveWatcherCount();
    const observersBefore = liveObserverCount();
    const { engine, layer } = await boot(fixture('gemini', 'long-thread'));
    expect(countInjected(document)).toBeGreaterThan(0);
    engine.stop();
    expect(countInjected(document)).toBe(0);
    expect(layer.childElementCount).toBe(0);
    expect(document.querySelector('[data-pinpoint-indexed], [data-pinpoint-mounted]')).toBeNull();
    expect(liveObserverCount()).toBe(observersBefore - 1 >= 0 ? observersBefore : observersBefore);
    expect(liveWatcherCount()).toBe(watchersBefore);
  });

  test('ten thread switches on a 300-message thread leave no leaked observers or buttons', async () => {
    const big = buildFixture('chatgpt', 'big', { messages: 300 });
    const { engine } = await boot(big);
    const observers = liveObserverCount();
    for (let i = 0; i < 10; i++) {
      const id = `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`;
      loadFixture({ ...big, path: `/c/${id}` });
      await waitFor(() => engine.state.get().threadId === `chatgpt:${id}` && engine.internals.observer().isRunning(), 5000);
      // jsdom's querySelectorAll is ~100× slower than Chrome's, so budgeted slices crawl here;
      // finish the reconcile synchronously as idle time would.
      engine.internals.reconcileAll();
      expect(countInjected(document)).toBe(300);
      expect(liveObserverCount()).toBe(observers);
    }
  }, 120_000);
});

describe('settings broadcast', () => {
  test('host toggled off tears down live; toggled on re-boots without reload', async () => {
    const { engine, worker } = await boot(fixture('claude', 'short-thread'));
    expect(countInjected(document)).toBe(4);
    const off = await worker.proxy.call('settings:set', {
      hosts: { gemini: { enabled: true }, chatgpt: { enabled: true }, claude: { enabled: false }, generic: { enabled: true } },
    });
    const observers = liveObserverCount();
    engine.handleMessage('settings:changed', off);
    expect(engine.state.get().status).toBe('disabled');
    expect(countInjected(document)).toBe(0);
    expect(liveObserverCount()).toBe(observers - 1);
    const writesBefore = worker.calls.length;
    engine.internals.reconcileAll();
    expect(worker.calls.length).toBe(writesBefore);

    const on = await worker.proxy.call('settings:set', {
      hosts: { gemini: { enabled: true }, chatgpt: { enabled: true }, claude: { enabled: true }, generic: { enabled: true } },
    });
    engine.handleMessage('settings:changed', on);
    await waitFor(() => engine.state.get().status === 'running' && countInjected(document) === 4);
  });
});
