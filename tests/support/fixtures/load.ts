/**
 * Loads a synthetic host fixture into the jsdom document. jsdom has no layout, so a small
 * shim makes elements with an inline `overflow-y: auto|scroll` report a scrollable height
 * when the fixture is a long thread (TESTING.md §3 A2).
 */
import type { Fixture } from './synth';

const TALL = 10_000;
const VIEWPORT = 800;
let scrolls = false;

function overflows(el: HTMLElement): boolean {
  return /overflow-y:\s*(auto|scroll)/.test(el.getAttribute('style') ?? '');
}

let installed = false;
function installLayoutShim(): void {
  if (installed) return;
  installed = true;
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return scrolls && overflows(this) ? TALL : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return overflows(this) ? VIEWPORT : 0;
    },
  });
}

export function loadFixture(f: Fixture): void {
  installLayoutShim();
  scrolls = f.scrolls;
  const parsed = new DOMParser().parseFromString(f.html, 'text/html');
  document.title = parsed.title;
  document.body.replaceChildren(...[...parsed.body.childNodes].map((n) => document.importNode(n, true)));
  history.replaceState(null, '', f.path);
}

export function resetDocument(): void {
  document.title = '';
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
}

/** A Location-shaped URL for `matches`/`getThreadId`. */
export function loc(url: string): Location {
  return new URL(url) as unknown as Location;
}
