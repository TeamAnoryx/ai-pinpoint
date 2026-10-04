/**
 * MutationObserver lifecycle (ARCHITECTURE.md §5, §10, §11). Trailing debounce, early
 * filtering of streaming churn and our own UI, frame-budgeted work with idle continuation,
 * and failure counting — the callback never throws (CLAUDE.md R11).
 */
import {
  ADAPTER_FAILURE_LIMIT,
  ADAPTER_FAILURE_WINDOW_MS,
  IDLE_FALLBACK_MS,
  MUTATION_DEBOUNCE_MS,
  MUTATION_MAX_WAIT_MS,
  RECONCILE_FRAME_MS,
} from '@shared/constants';
import { logger } from '@shared/logger';

const log = logger('observer');

/** Selector for everything we inject; mutations inside it are ours, never the host's. */
export const OWN_UI_SELECTOR = '[data-pinpoint-ui], [data-pinpoint-btn], #ai-pinpoint-root';
/** Nodes whose text churn is irrelevant: already indexed, or flagged as streaming. */
export const CHURN_SCOPE_SELECTOR = '[data-pinpoint-indexed], [data-pinpoint-streaming]';

export interface Budget {
  /** Milliseconds left in this slice; work should yield when it reaches 0. */
  timeLeft(): number;
}

export interface ObserverOptions {
  /**
   * One reconcile slice. Return `true` when finished, `false` to be continued in an idle
   * callback with a fresh budget.
   */
  onBatch(budget: Budget): boolean;
  /** Called when failures reach ADAPTER_FAILURE_LIMIT within ADAPTER_FAILURE_WINDOW_MS. */
  onFatal?(error: unknown): void;
  now?: () => number;
}

let live = 0;
/** Leak counter for teardown tests: observers created and not yet stopped. */
export function liveObserverCount(): number {
  return live;
}

function isElement(n: Node): n is Element {
  return n.nodeType === Node.ELEMENT_NODE;
}

function closestElement(n: Node): Element | null {
  return isElement(n) ? n : n.parentElement;
}

type ScopeCache = Map<Element, { own: boolean; churn: boolean }>;

function scopeOf(target: Element, cache: ScopeCache): { own: boolean; churn: boolean } {
  let hit = cache.get(target);
  if (!hit) {
    hit = { own: target.closest(OWN_UI_SELECTOR) !== null, churn: target.closest(CHURN_SCOPE_SELECTOR) !== null };
    cache.set(target, hit);
  }
  return hit;
}

/**
 * True when a record can matter to reconcile (ARCHITECTURE.md §11 filter). A streaming
 * burst delivers many records for the same target, so scope lookups are memoised per batch.
 */
export function isRelevant(record: MutationRecord, cache: ScopeCache = new Map()): boolean {
  const target = closestElement(record.target);
  if (!target) return false;
  const scope = scopeOf(target, cache);
  if (scope.own) return false;
  if (record.type === 'characterData') return !scope.churn;
  if (record.type === 'attributes') return !(record.attributeName ?? '').startsWith('data-pinpoint');
  let onlyText = true;
  let allOurs = true;
  const visit = (list: NodeList): void => {
    for (const n of list) {
      if (!isElement(n)) {
        allOurs = false;
        continue;
      }
      onlyText = false;
      if (!n.matches(OWN_UI_SELECTOR)) allOurs = false;
    }
  };
  visit(record.addedNodes);
  visit(record.removedNodes);
  const empty = record.addedNodes.length + record.removedNodes.length === 0;
  if (!empty && allOurs) return false;
  if (onlyText && scope.churn) return false;
  return true;
}

interface IdleApi {
  request(cb: () => void): number;
  cancel(id: number): void;
}

function idleApi(): IdleApi {
  if (typeof requestIdleCallback === 'function') {
    return { request: (cb) => requestIdleCallback(cb), cancel: (id) => cancelIdleCallback(id) };
  }
  return {
    request: (cb) => setTimeout(cb, IDLE_FALLBACK_MS) as unknown as number,
    cancel: (id) => clearTimeout(id),
  };
}

export function createObserver(opts: ObserverOptions) {
  const now = opts.now ?? (() => performance.now());
  const idle = idleApi();
  let mo: MutationObserver | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  /** When the pending debounce was first requested; bounds starvation under a storm. */
  let pendingSince: number | null = null;
  let idleId: number | null = null;
  let running = false;
  let stopped = false;
  let failures: number[] = [];

  function fail(err: unknown): void {
    const t = now();
    failures = [...failures.filter((f) => t - f < ADAPTER_FAILURE_WINDOW_MS), t];
    log.warn('reconcile failed', failures.length, err);
    if (failures.length >= ADAPTER_FAILURE_LIMIT) {
      stop();
      try {
        opts.onFatal?.(err);
      } catch (fatalErr) {
        log.error('onFatal threw', fatalErr);
      }
    }
  }

  function slice(): void {
    idleId = null;
    if (stopped) return;
    running = true;
    const start = now();
    let done = true;
    try {
      done = opts.onBatch({ timeLeft: () => RECONCILE_FRAME_MS - (now() - start) });
    } catch (err) {
      fail(err);
    } finally {
      running = false;
    }
    if (!done && !stopped) idleId = idle.request(slice);
  }

  /** Schedule a reconcile after the trailing debounce (also used for streaming re-checks). */
  function schedule(delay = MUTATION_DEBOUNCE_MS): void {
    if (stopped) return;
    const t = now();
    pendingSince ??= t;
    const wait = Math.max(0, Math.min(delay, pendingSince + MUTATION_MAX_WAIT_MS - t));
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      pendingSince = null;
      if (idleId !== null) {
        // A continuation is pending; restart the reconcile from the top with fresh state.
        idle.cancel(idleId);
        idleId = null;
      }
      if (!running) slice();
    }, wait);
  }

  function onRecords(records: MutationRecord[]): void {
    try {
      const cache: ScopeCache = new Map();
      if (records.some((r) => isRelevant(r, cache))) schedule();
    } catch (err) {
      fail(err);
    }
  }

  function start(root: Node): void {
    if (mo || stopped) return;
    mo = new MutationObserver(onRecords);
    mo.observe(root, { childList: true, subtree: true });
    live++;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (mo) {
      mo.disconnect();
      mo = null;
      live--;
    }
    if (debounce !== null) clearTimeout(debounce);
    if (idleId !== null) idle.cancel(idleId);
    debounce = null;
    idleId = null;
    pendingSince = null;
  }

  return {
    start,
    stop,
    schedule,
    /** Run a reconcile now (boot, thread change) instead of waiting for a mutation. */
    runNow(): void {
      if (!stopped && !running) slice();
    },
    isRunning: (): boolean => mo !== null && !stopped,
    failureCount: (): number => failures.length,
    /** Exposed for tests: feed records directly. */
    handle: onRecords,
  };
}

export type Observer = ReturnType<typeof createObserver>;
