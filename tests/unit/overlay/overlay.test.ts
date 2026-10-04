import { STREAM_SAMPLE_MS } from '@shared/constants';
import { createClaudeAdapter } from '@content/adapters/claude';
import { createEngine, type Engine } from '@content/core/engine';
import { mountOverlay, OVERLAY_HOST_ID, type OverlayHandle } from '@content/overlay/mount';
import { fixture } from '../../support/fixtures/synth';
import { loadFixture, resetDocument } from '../../support/fixtures/load';
import { makeWorker } from '../../support/worker';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await tick(5);
  }
};

let engine: Engine;
let overlay: OverlayHandle;
let worker: ReturnType<typeof makeWorker>;
const copied: string[] = [];
const opened: number[] = [];

async function setup(name = 'short-thread') {
  const f = fixture('claude', name);
  loadFixture(f);
  worker = makeWorker();
  overlay = mountOverlay();
  engine = createEngine({
    adapter: createClaudeAdapter({ now: () => 0 }),
    proxy: worker.proxy,
    layer: overlay.layer,
    hostLabel: 'claude.ai',
    loc: () => new URL(`https://claude.ai${location.pathname}`) as unknown as Location,
  });
  overlay.attach(engine, {
    openOptions: () => opened.push(1),
    copyText: async (t) => {
      copied.push(t);
    },
  });
  await engine.start();
  await tick();
  return f;
}

const $ = <T extends Element = HTMLElement>(sel: string): T | null => overlay.shadow.querySelector<T>(sel);
const $$ = (sel: string): HTMLElement[] => [...overlay.shadow.querySelectorAll<HTMLElement>(sel)];
const key = (el: Element, k: string, init: KeyboardEventInit = {}): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
};

async function open(): Promise<void> {
  $<HTMLButtonElement>('.pp-handle')!.click();
  await waitFor(() => $('.pp-sidebar') !== null);
}

async function pinAll(): Promise<void> {
  const adapter = createClaudeAdapter({ now: () => STREAM_SAMPLE_MS });
  for (const n of adapter.listMessageNodes()) await engine.intents.pinNode(n);
  await waitFor(() => engine.state.get().pins.length === 4);
  if (engine.state.get().sidebarOpen) await waitFor(() => $$('.pp-card').length === 4);
}

afterEach(() => {
  engine?.stop();
  overlay?.destroy();
  copied.length = 0;
  opened.length = 0;
  resetDocument();
});

describe('mount isolation', () => {
  test('one host on <html> with a closed shadow root; the host page is untouched', async () => {
    loadFixture(fixture('claude', 'short-thread'));
    const before = document.body.outerHTML;
    overlay = mountOverlay();
    const host = document.getElementById(OVERLAY_HOST_ID)!;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.shadowRoot).toBeNull(); // closed
    expect(host.style.pointerEvents).toBe('none');
    expect(document.body.outerHTML).toBe(before);
    overlay.destroy();
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();
    expect(document.body.outerHTML).toBe(before);
  });

  test('collapsed overlay: only the handle takes pointer events', async () => {
    await setup();
    expect($('.pp-handle')).not.toBeNull();
    expect($('.pp-sidebar')).toBeNull();
    expect(overlay.root.className).toBe('pp-root');
    // .pp-root and .pp-layer are pointer-events:none in the adopted sheet; the handle is auto.
    expect($$('[style*="pointer-events: auto"]').length).toBe(0);
  });
});

describe('sidebar', () => {
  test('empty state, then cards with role labels and text-only snippets', async () => {
    await setup();
    await open();
    expect($('[role="complementary"]')!.getAttribute('aria-label')).toBe('AI Pinpoint pinned messages');
    expect($('.pp-empty')!.textContent).toContain('No pins in this chat yet');
    await pinAll();
    const first = $$('.pp-card-main')[0]!;
    expect(first.getAttribute('aria-label')).toMatch(/^User message, Fixture user message 0/);
    expect($$('.pp-role').map((r) => r.textContent)).toEqual(['User', 'AI', 'User', 'AI']);
  });

  test('a snippet containing markup renders as text, never as elements', async () => {
    await setup();
    await open();
    const node = createClaudeAdapter().listMessageNodes()[0]!;
    node.querySelector('[data-testid="user-message"] p')!.textContent = '<img src=x onerror=alert(1)> hi';
    engine.internals.identity.invalidate(node);
    engine.internals.reconcileAll();
    await engine.intents.pinNode(node);
    await waitFor(() => $$('.pp-card').length === 1);
    expect(overlay.shadow.querySelector('img')).toBeNull();
    expect($('.pp-primary')!.textContent).toContain('<img src=x');
  });

  test('keyboard walkthrough: move, rename, reorder, unpin, undo — no mouse', async () => {
    await setup();
    await open();
    await pinAll();
    const ids = () => engine.state.get().pins.map((p) => p.pin.pinId);
    const original = ids();
    const card = (i: number) => $$('.pp-card-main')[i]!;

    card(0).focus();
    key(card(0), 'ArrowDown');
    await tick(20);
    expect(overlay.shadow.activeElement).toBe(card(1));

    key(card(1), 'F2');
    await waitFor(() => $('.pp-edit') !== null);
    const input = $<HTMLInputElement>('.pp-edit')!;
    input.value = 'Key answer';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    key(input, 'Enter');
    await waitFor(() => engine.state.get().pins[1]!.pin.label === 'Key answer');

    await waitFor(() => $$('.pp-card-main').length === 4);
    key(card(1), 'ArrowUp', { altKey: true });
    await waitFor(() => ids()[0] === original[1]);
    expect(ids()).toEqual([original[1], original[0], original[2], original[3]]);

    key(card(0), 'Delete');
    await waitFor(() => engine.state.get().pins.length === 3).catch(() => {
      throw new Error(`pins=${engine.state.get().pins.length} toast=${JSON.stringify(engine.state.get().toast)} active=${overlay.shadow.activeElement?.className}`);
    });
    await waitFor(() => engine.state.get().toast?.action === 'undo');
    await waitFor(() => $('.pp-toast button') !== null);
    $<HTMLButtonElement>('.pp-toast button')!.click();
    await waitFor(() => engine.state.get().pins.length === 4);
    const restored = engine.state.get().pins.map((p) => p.pin);
    expect(restored[0]!.pinId).toBe(original[1]);
    expect(restored[0]!.label).toBe('Key answer');
  });

  test('filter shows a result count and Esc clears it', async () => {
    await setup();
    await open();
    await pinAll();
    const input = $<HTMLInputElement>('.pp-filter input')!;
    input.value = 'assistant message 1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => $$('.pp-card').length === 1);
    expect($('.pp-results')!.textContent).toBe('1 result');
    key(input, 'Escape');
    await waitFor(() => $$('.pp-card').length === 4);
  });

  test('card menu: copy snippet (write only) and unpin', async () => {
    await setup();
    await open();
    await pinAll();
    $$('.pp-menu-btn')[2]!.click();
    await waitFor(() => $('[role="menu"]') !== null);
    $$('[role="menuitem"]')[1]!.click();
    await waitFor(() => copied.length === 1);
    expect(copied[0]).toContain('Fixture user message 2');
    $$('.pp-menu-btn')[2]!.click();
    await waitFor(() => $('[role="menu"]') !== null);
    $$('[role="menuitem"]')[2]!.click();
    await waitFor(() => engine.state.get().pins.length === 3);
  });

  test('Esc collapses; tabs switch to the thread list with arrow keys', async () => {
    const f = await setup();
    await open();
    await pinAll();
    const tab = $$('[role="tab"]')[0]!;
    tab.focus();
    key(tab, 'ArrowRight');
    await waitFor(() => $('.pp-thread') !== null);
    expect($('.pp-thread')!.getAttribute('aria-current')).toBe('page');
    expect(engine.state.get().threads[0]!.threadId).toBe(f.threadId);
    key($('.pp-sidebar')!, 'Escape');
    await waitFor(() => $('.pp-sidebar') === null);
  });

  test('settings gear asks the worker to open options', async () => {
    await setup();
    await open();
    $<HTMLButtonElement>('[aria-label="Open settings"]')!.click();
    expect(opened).toHaveLength(1);
  });
});

describe('host deference and theming', () => {
  test('a host modal collapses the sidebar and fades the handle; closing restores it', async () => {
    await setup();
    await open();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    await waitFor(() => $('.pp-sidebar') === null);
    expect($('.pp-handle')!.getAttribute('data-faded')).toBe('true');
    dialog.remove();
    await waitFor(() => $('.pp-sidebar') !== null);
  });

  test('theme, reduced motion, and RTL attributes follow settings and the page', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    try {
      await setup();
      await engine.intents.updateSettings({ theme: 'dark', reducedMotion: 'on' });
      await waitFor(() => overlay.root.getAttribute('data-theme') === 'dark');
      expect(overlay.root.getAttribute('data-motion')).toBe('reduced');
      expect(overlay.root.getAttribute('dir')).toBe('rtl');
    } finally {
      document.documentElement.removeAttribute('dir');
    }
  });

  test('health banner for a layout without action rows', async () => {
    await setup('no-action-rows');
    await open();
    await waitFor(() => $('.pp-banner') !== null);
    expect($('.pp-banner')!.textContent).toContain('This layout hides the pin button');
    $<HTMLButtonElement>('.pp-banner [aria-label="Dismiss"]')!.click();
    await waitFor(() => $('.pp-banner') === null);
  });

  test('live region announces pins', async () => {
    await setup();
    await pinAll();
    await waitFor(() => ($('[aria-live="polite"].pp-sr')?.textContent ?? '') === 'Pinned');
  });
});
