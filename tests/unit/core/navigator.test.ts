import { createClaudeAdapter } from '@content/adapters/claude';
import type { HostAdapter } from '@content/adapters/types';
import { createIdentity, type PinTarget } from '@content/core/identity';
import { createNavigator, type NavigatorDeps } from '@content/core/navigator';
import { fixture } from '../../support/fixtures/synth';
import { loadFixture, resetDocument } from '../../support/fixtures/load';
import { scrolledIntoView } from '../../support/dom-polyfills';
import { RECOVERY_NEAR_STEPS } from '@shared/constants';

const ROW_PX = 100;
const WINDOW_ROWS = 20;
const VIEWPORT = 800;

/**
 * Turns the Claude long-thread fixture into a virtualised transcript: only WINDOW_ROWS rows
 * around the scroll position are mounted, like the real host (D-011).
 */
function virtualise(): { container: HTMLElement; rows: HTMLElement[]; mounted: () => HTMLElement[] } {
  loadFixture(fixture('claude', 'long-thread'));
  const container = document.querySelector<HTMLElement>('[data-autoscroll-container]')!;
  const sizer = container.querySelector<HTMLElement>('[data-testid="transcript-sizer"]')!;
  const rows = [...sizer.querySelectorAll<HTMLElement>('[data-testid="transcript-row"]')];
  let top = 0;
  const total = rows.length * ROW_PX;
  const render = (): void => {
    const first = Math.min(rows.length - WINDOW_ROWS, Math.max(0, Math.floor(top / ROW_PX) - 4));
    sizer.replaceChildren(...rows.slice(first, first + WINDOW_ROWS));
  };
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => total });
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(total - VIEWPORT, v));
      render();
    },
  });
  render();
  return { container, rows, mounted: () => [...sizer.children] as HTMLElement[] };
}

function setup(extra: Partial<NavigatorDeps> = {}) {
  const adapter: HostAdapter = createClaudeAdapter({ now: () => 0 });
  const identity = createIdentity(adapter);
  const reconcile = (): void => identity.rebuildIndex(adapter.listMessageNodes());
  const highlight = vi.fn();
  let t = 0;
  const nav = createNavigator({
    adapter,
    identity,
    reconcile,
    highlight,
    clearHighlight: vi.fn(),
    reducedMotion: () => true,
    now: () => (t += 10),
    sleep: async () => undefined,
    nextFrame: async () => undefined,
    ...extra,
  });
  reconcile();
  return { adapter, identity, reconcile, highlight, nav };
}

function pinFor(identity: ReturnType<typeof createIdentity>, node: HTMLElement): PinTarget {
  const d = identity.describe(node, 140)!;
  return { targetHash: d.targetHash, nativeId: d.nativeId, role: d.role, snippet: d.snippet, ordinal: d.ordinal };
}

afterEach(resetDocument);

describe('navigator', () => {
  test('mounted target: centred and highlighted', async () => {
    loadFixture(fixture('claude', 'long-thread'));
    const { identity, nav, highlight, adapter } = setup();
    const node = adapter.listMessageNodes()[57]!;
    scrolledIntoView.length = 0;
    const r = await nav.goTo(pinFor(identity, node));
    expect(r.status).toBe('found');
    expect(scrolledIntoView).toContain(node);
    expect(highlight).toHaveBeenCalledWith(node);
  });

  test('unmounted target below the window: recovery sweeps down and finds it', async () => {
    const v = virtualise();
    v.container.scrollTop = 9000; // mount rows near 90
    const { identity, nav, highlight, reconcile } = setup();
    const target = v.rows[100]!.querySelector<HTMLElement>('[role="article"]')!;
    const pin = pinFor(identity, target);
    v.container.scrollTop = 0;
    reconcile();
    expect(target.isConnected).toBe(false);
    const r = await nav.goTo(pin);
    expect(r.status).toBe('found');
    expect(highlight).toHaveBeenCalledWith(target);
  });

  test('unmounted target above the window: recovery sweeps up and finds it', async () => {
    const v = virtualise();
    v.container.scrollTop = 500;
    const { identity, nav, highlight, reconcile } = setup();
    const target = v.rows[8]!.querySelector<HTMLElement>('[role="article"]')!;
    const pin = pinFor(identity, target);
    v.container.scrollTop = 11_000;
    reconcile();
    expect(target.isConnected).toBe(false);
    expect((await nav.goTo(pin)).status).toBe('found');
    expect(highlight).toHaveBeenCalledWith(target);
  });

  test('far target: after the near sweep recovery jumps to the far end (D-019)', async () => {
    const v = virtualise();
    v.container.scrollTop = 0;
    let sleeps = 0;
    const { identity, nav, highlight, reconcile } = setup({ sleep: async () => void sleeps++ });
    const target = v.rows[1]!.querySelector<HTMLElement>('[role="article"]')!;
    const pin = pinFor(identity, target);
    v.container.scrollTop = 1e9;
    reconcile();
    expect(target.isConnected).toBe(false);
    expect((await nav.goTo(pin)).status).toBe('found');
    expect(highlight).toHaveBeenCalledWith(target);
    expect(sleeps).toBeLessThanOrEqual(RECOVERY_NEAR_STEPS + 2);
  });

  test('user scroll during recovery aborts and restores the scroll position', async () => {
    const v = virtualise();
    v.container.scrollTop = 3000;
    let steps = 0;
    const { nav } = setup({
      sleep: async () => {
        if (++steps === 2) dispatchEvent(new Event('wheel'));
      },
    });
    const r = await nav.goTo({ targetHash: 'n:none', nativeId: 'missing', role: 'user', snippet: 'qqq zzz', ordinal: 0 });
    expect(r.status).toBe('aborted');
    expect(v.container.scrollTop).toBe(3000);
  });

  test('NOT_FOUND after the sweep restores the scroll position', async () => {
    const v = virtualise();
    v.container.scrollTop = 4000;
    const { nav, highlight } = setup();
    const r = await nav.goTo({ targetHash: 'n:none', nativeId: 'missing', role: 'user', snippet: 'qqq zzz', ordinal: 3 });
    expect(r.status).toBe('not-found');
    expect(v.container.scrollTop).toBe(4000);
    expect(highlight).not.toHaveBeenCalled();
  });

  test('a new navigation supersedes the in-flight one without restoring its scroll', async () => {
    const v = virtualise();
    v.container.scrollTop = 2000;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const { nav, identity, adapter } = setup({
      sleep: async () => {
        if (first) {
          first = false;
          await gate;
        }
      },
    });
    const livePin = pinFor(identity, adapter.listMessageNodes()[3]!);
    const missing = nav.goTo({ targetHash: 'n:none', nativeId: 'missing', role: 'user', snippet: 'qqq', ordinal: 0 });
    const second = nav.goTo(livePin);
    release();
    expect((await missing).status).toBe('aborted');
    expect((await second).status).toBe('found');
  });
});
