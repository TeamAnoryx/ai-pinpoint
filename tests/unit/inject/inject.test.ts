import { OBSERVER_ROOT_TIMEOUT_MS } from '@shared/constants';
import { evaluateHealth } from '@content/core/health';
import { createFloatingButtons, createHighlighter } from '@content/inject/highlight';
import {
  countInjected,
  createPinButton,
  mountPinButton,
  removeInjected,
  setPinState,
} from '@content/inject/pin-button';

const OPTS = { dark: false, reducedMotion: true, hotkeyHint: 'Alt+Shift+P' };

afterEach(() => document.body.replaceChildren());

describe('pin button', () => {
  test('defensive inline styles, a11y state, and an SVG built without innerHTML', () => {
    const onActivate = vi.fn();
    const btn = createPinButton({ ...OPTS, hash: 'c:x:1', state: 'unpinned', styleHint: 'icon-ghost', onActivate });
    expect(btn.getAttribute('style')!.startsWith('all: unset')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Pin this message');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.title).toContain('Alt+Shift+P');
    expect(btn.querySelector('svg path')).not.toBeNull();
    expect(btn.style.width).toBe('28px');

    setPinState(btn, 'pinned', OPTS);
    expect(btn.getAttribute('aria-label')).toBe('Unpin this message');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('style')).toContain('opacity: 1 !important');
  });

  test('click stops propagation to host row handlers', () => {
    const onActivate = vi.fn();
    const row = document.createElement('div');
    const hostHandler = vi.fn();
    row.addEventListener('click', hostHandler);
    document.body.append(row);
    const btn = createPinButton({ ...OPTS, hash: 'h', state: 'unpinned', styleHint: 'icon-ghost', onActivate });
    mountPinButton({ container: row, position: 'append' }, btn);
    btn.click();
    expect(onActivate).toHaveBeenCalledWith(btn);
    expect(hostHandler).not.toHaveBeenCalled();
  });

  test('double-mount guard, positions, and full removal', () => {
    const row = document.createElement('div');
    const anchor = document.createElement('span');
    row.append(anchor);
    document.body.append(row);
    const make = () => createPinButton({ ...OPTS, hash: 'h', state: 'pinned', styleHint: 'icon-ghost', onActivate: () => undefined });
    expect(mountPinButton({ container: row, position: 'append' }, make())).toBe(true);
    expect(mountPinButton({ container: row, position: 'prepend' }, make())).toBe(false);
    expect(row.getAttribute('data-pinpoint-mounted')).toBe('1');
    expect(row.getAttribute('data-pinpoint-has-pin')).toBe('1');
    const other = document.createElement('div');
    const a2 = document.createElement('span');
    other.append(a2);
    document.body.append(other);
    mountPinButton({ container: other, position: 'before', anchor: a2 }, make());
    expect(other.firstElementChild?.hasAttribute('data-pinpoint-btn')).toBe(true);
    anchor.setAttribute('data-pinpoint-indexed', '1');
    removeInjected(document);
    expect(countInjected(document)).toBe(0);
    expect(document.querySelector('[data-pinpoint-mounted], [data-pinpoint-has-pin], [data-pinpoint-indexed]')).toBeNull();
  });
});

describe('highlight layer', () => {
  test('draws a ring in the layer, never styles the host node, and clears', () => {
    vi.useFakeTimers();
    try {
      const layer = document.createElement('div');
      const target = document.createElement('p');
      document.body.append(layer, target);
      const before = target.getAttribute('style');
      const h = createHighlighter(layer);
      h.show(target, null, { durationMs: 1200, reducedMotion: true, dark: false });
      expect(layer.querySelector('[data-pinpoint-ui="highlight"]')).not.toBeNull();
      expect(target.getAttribute('style')).toBe(before);
      vi.advanceTimersByTime(1200);
      expect(h.isActive()).toBe(false);
      expect(layer.childElementCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a new highlight replaces the previous one', () => {
    const layer = document.createElement('div');
    const a = document.createElement('p');
    const b = document.createElement('p');
    document.body.append(layer, a, b);
    const h = createHighlighter(layer);
    h.show(a, null, { durationMs: 1200, reducedMotion: true, dark: true });
    h.show(b, null, { durationMs: 1200, reducedMotion: true, dark: true });
    expect(layer.querySelectorAll('[data-pinpoint-ui="highlight"]')).toHaveLength(1);
    h.destroy();
    expect(layer.childElementCount).toBe(0);
  });

  test('floating buttons live in the layer and are pruned with their node', () => {
    const layer = document.createElement('div');
    const node = document.createElement('article');
    document.body.append(layer, node);
    const f = createFloatingButtons(layer);
    const btn = document.createElement('button');
    f.attach(node, btn);
    expect(layer.contains(btn)).toBe(true);
    expect(btn.style.position).toBe('fixed');
    node.remove();
    f.prune();
    expect(f.count()).toBe(0);
    expect(btn.isConnected).toBe(false);
    f.destroy();
  });
});

describe('health', () => {
  const probe = { scrollContainer: true, observerRoot: true, messageNodes: 4, actionBarMounts: 4, threadId: true, nativeIds: true };
  const base = { probe, transient: false, fallback: false, drift: false, elapsedMs: 0, adapterFailed: false };

  test.each([
    [{}, 'healthy'],
    [{ probe: { ...probe, actionBarMounts: 0 } }, 'degraded:no-mount'],
    [{ transient: true }, 'degraded:no-thread'],
    [{ probe: { ...probe, messageNodes: 0 }, elapsedMs: OBSERVER_ROOT_TIMEOUT_MS }, 'degraded:no-messages'],
    [{ probe: { ...probe, messageNodes: 0 }, elapsedMs: 10 }, 'healthy'],
    [{ adapterFailed: true }, 'disabled:adapter-error'],
  ] as const)('%o → %s', (patch, state) => {
    expect(evaluateHealth({ ...base, ...patch }).state).toBe(state);
  });

  test('carries fallback and drift flags', () => {
    expect(evaluateHealth({ ...base, fallback: true, drift: true })).toMatchObject({ fallback: true, drift: true });
  });
});
