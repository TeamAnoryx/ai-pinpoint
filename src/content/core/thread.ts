/**
 * Thread identity and SPA navigation watching (DATA_MODEL.md §3, EDGE_CASES.md §4–§5).
 * Hosts switch threads with the History API from the page's main world, which an isolated
 * content script cannot hook; we combine popstate, a <title> observer, and a cheap href tick.
 */
import { HREF_TICK_MS, THREAD_SETTLE_MS } from '@shared/constants';
import type { HostAdapter } from '@content/adapters/types';

export const TRANSIENT_PREFIX = 'transient:';

export function isTransient(threadId: string): boolean {
  return threadId.startsWith(TRANSIENT_PREFIX);
}

/** Fresh per page load; never reused (DATA_MODEL.md §3). */
export function sessionNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function resolveThreadId(adapter: HostAdapter, loc: Location, nonce: string): string {
  return adapter.getThreadId(loc) ?? `${TRANSIENT_PREFIX}${adapter.id}:${nonce}`;
}

export interface ThreadChange {
  previous: string;
  next: string;
  /** The previous scope was transient: the engine may promote its in-memory pins. */
  fromTransient: boolean;
}

export interface ThreadWatcherOptions {
  adapter: HostAdapter;
  nonce: string;
  onChange(change: ThreadChange): void;
  /** Injectable for tests. */
  loc?: () => Location;
}

let live = 0;
export function liveWatcherCount(): number {
  return live;
}

export function createThreadWatcher(opts: ThreadWatcherOptions) {
  const loc = opts.loc ?? (() => location);
  let current = resolveThreadId(opts.adapter, loc(), opts.nonce);
  let lastHref = loc().href;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let titleObserver: MutationObserver | null = null;
  let active = false;

  function settled(): void {
    settle = null;
    const next = resolveThreadId(opts.adapter, loc(), opts.nonce);
    if (next === current) return;
    const change: ThreadChange = { previous: current, next, fromTransient: isTransient(current) };
    current = next;
    opts.onChange(change);
  }

  function check(): void {
    const href = loc().href;
    if (href === lastHref) return;
    lastHref = href;
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(settled, THREAD_SETTLE_MS);
  }

  return {
    current: (): string => current,

    start(): void {
      if (active) return;
      active = true;
      live++;
      addEventListener('popstate', check);
      tick = setInterval(check, HREF_TICK_MS);
      titleObserver = new MutationObserver(check);
      titleObserver.observe(document.head ?? document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    },

    stop(): void {
      if (!active) return;
      active = false;
      live--;
      removeEventListener('popstate', check);
      if (tick !== null) clearInterval(tick);
      if (settle !== null) clearTimeout(settle);
      titleObserver?.disconnect();
      tick = null;
      settle = null;
      titleObserver = null;
    },

    /** Force a check (e.g. after the engine sees the observer root detach). */
    check,
  };
}

export type ThreadWatcher = ReturnType<typeof createThreadWatcher>;
