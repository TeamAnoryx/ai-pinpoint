/**
 * Injected per-message pin button (UI_SPEC.md §5, ADAPTERS.md §8). It lives in host DOM, so
 * every style is inline and starts from `all: unset`; the icon is built with createElementNS
 * (EDGE_CASES.md §20 — no innerHTML under Trusted Types).
 */
import type { MountPoint } from '@content/adapters/types';

export type PinState = 'unpinned' | 'pinned' | 'busy';

export const PIN_BTN_ATTR = 'data-pinpoint-btn';
export const MOUNTED_ATTR = 'data-pinpoint-mounted';
export const HAS_PIN_ATTR = 'data-pinpoint-has-pin';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 16×16 pin glyph, 1.5px stroke, currentColor (UI_SPEC.md §3). */
const PIN_PATH = 'M9.5 2.5l4 4-2 1-2.5 2.5.5 3-1.5 1.5-2.5-2.5-3.5 3.5-.5-.5 3.5-3.5L2 8.5 3.5 7l3 .5L9 5z';

export const ACCENT_LIGHT = '#3b6cf6';
export const ACCENT_DARK = '#7aa2ff';

export interface PinButtonOptions {
  hash: string;
  state: PinState;
  styleHint: MountPoint['styleHint'];
  /** Resolved once at mount from prefers-color-scheme (UI_SPEC.md §5). */
  dark: boolean;
  reducedMotion: boolean;
  hotkeyHint: string;
  onActivate(button: HTMLButtonElement): void;
}

function icon(filled: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.cssText = 'display:block;pointer-events:none';
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', PIN_PATH);
  path.setAttribute('fill', filled ? 'currentColor' : 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function styleFor(state: PinState, dark: boolean, reducedMotion: boolean): string {
  const accent = dark ? ACCENT_DARK : ACCENT_LIGHT;
  const pinned = state === 'pinned';
  return [
    'all: unset',
    'box-sizing: border-box',
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
    'flex: 0 0 auto',
    'width: 28px',
    'height: 28px',
    'min-width: 28px',
    'cursor: pointer',
    'line-height: 0',
    'border-radius: 6px',
    'background: transparent',
    `color: ${pinned ? accent : 'currentColor'}`,
    pinned ? 'opacity: 1 !important' : 'opacity: .55',
    'visibility: visible !important',
    'position: relative',
    // No keyframes are possible without a host stylesheet; busy is a dimmed progress cursor.
    state === 'busy' ? `cursor: progress; opacity: ${reducedMotion ? '.55' : '.35'}` : '',
  ]
    .filter(Boolean)
    .join(';');
}

/** Apply a state to an existing button (label, pressed, icon, style). */
export function setPinState(btn: HTMLButtonElement, state: PinState, opts: Pick<PinButtonOptions, 'dark' | 'reducedMotion' | 'hotkeyHint'>): void {
  btn.dataset['pinpointState'] = state;
  const pinned = state === 'pinned';
  const label = pinned ? 'Unpin this message' : 'Pin this message';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(pinned));
  btn.setAttribute('aria-busy', String(state === 'busy'));
  btn.title = `${label} (${opts.hotkeyHint})`;
  btn.style.cssText = styleFor(state, opts.dark, opts.reducedMotion);
  btn.replaceChildren(icon(pinned));
  const row = btn.parentElement;
  if (row) {
    if (pinned) row.setAttribute(HAS_PIN_ATTR, '1');
    else row.removeAttribute(HAS_PIN_ATTR);
  }
}

export function createPinButton(opts: PinButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute(PIN_BTN_ATTR, '1');
  btn.dataset['pinpointHash'] = opts.hash;
  setPinState(btn, opts.state, opts);
  const accent = opts.dark ? ACCENT_DARK : ACCENT_LIGHT;
  const base = (): string => styleFor((btn.dataset['pinpointState'] as PinState) ?? 'unpinned', opts.dark, opts.reducedMotion);
  btn.addEventListener('pointerenter', () => {
    btn.style.cssText = `${base()};opacity:1 !important;background:rgba(127,127,127,.12)`;
  });
  btn.addEventListener('pointerleave', () => {
    btn.style.cssText = base();
  });
  btn.addEventListener('focus', () => {
    btn.style.cssText = `${base()};box-shadow:0 0 0 2px ${accent}`;
  });
  btn.addEventListener('blur', () => {
    btn.style.cssText = base();
  });
  btn.addEventListener('click', (e) => {
    // Host action rows often handle clicks on the container (UI_SPEC.md §5).
    e.stopPropagation();
    e.preventDefault();
    opts.onActivate(btn);
  });
  return btn;
}

/** Insert the button at the adapter's mount point. Returns false if already mounted there. */
export function mountPinButton(mp: MountPoint, btn: HTMLButtonElement): boolean {
  const existing = mp.container.querySelector(`[${PIN_BTN_ATTR}]`);
  if (existing && existing.isConnected) return false;
  switch (mp.position) {
    case 'append':
      mp.container.append(btn);
      break;
    case 'prepend':
      mp.container.prepend(btn);
      break;
    case 'before':
      (mp.anchor ?? mp.container).before(btn);
      break;
    case 'after':
      (mp.anchor ?? mp.container).after(btn);
      break;
  }
  mp.container.setAttribute(MOUNTED_ATTR, '1');
  if (btn.getAttribute('aria-pressed') === 'true') mp.container.setAttribute(HAS_PIN_ATTR, '1');
  return true;
}

/** Remove every injected button and every data-pinpoint-* attribute under `root` (R10). */
export function removeInjected(root: ParentNode = document): void {
  for (const btn of root.querySelectorAll(`[${PIN_BTN_ATTR}]`)) btn.remove();
  const marked = root.querySelectorAll(
    '[data-pinpoint-mounted], [data-pinpoint-has-pin], [data-pinpoint-indexed], [data-pinpoint-streaming], [data-pinpoint-hash]',
  );
  for (const el of marked) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('data-pinpoint-')) el.removeAttribute(attr.name);
    }
  }
}

export function countInjected(root: ParentNode = document): number {
  return root.querySelectorAll(`[${PIN_BTN_ATTR}]`).length;
}
