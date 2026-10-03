/**
 * Navigation state machine (ARCHITECTURE.md §7) with the recovery sweep of EDGE_CASES.md §2:
 * RESOLVE → (RECOVER) → SCROLL → HIGHLIGHT. Recovery is budgeted, abortable on user input
 * or a new navigation, and restores the user's scroll position when it fails.
 */
import {
  RECOVERY_BUDGET_MS,
  RECOVERY_MAX_STEPS,
  RECOVERY_STEP_RATIO,
  RECOVERY_STEP_WAIT_MS,
  SCROLL_SETTLE_FRAMES,
  SCROLL_SETTLE_MS,
} from '@shared/constants';
import type { HostAdapter } from '@content/adapters/types';
import type { Identity, PinTarget, Resolution } from './identity';

export type NotFoundReason = 'exhausted' | 'no-scroll-container' | 'not-loaded' | 'branch';

export type NavResult =
  | { status: 'found'; resolution: Resolution }
  | { status: 'not-found'; reason: NotFoundReason }
  | { status: 'aborted' };

export type NavPhase = 'locating' | 'scrolling' | 'highlight';

export interface NavigatorDeps {
  adapter: HostAdapter;
  identity: Identity;
  /** Re-index newly mounted nodes (one synchronous reconcile). */
  reconcile(): void;
  highlight(node: HTMLElement): void;
  clearHighlight(): void;
  reducedMotion(): boolean;
  onPhase?(phase: NavPhase): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  nextFrame?: () => Promise<void>;
}

class Aborted extends Error {}

const ABORT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export function createNavigator(deps: NavigatorDeps) {
  const now = deps.now ?? (() => performance.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const nextFrame = deps.nextFrame ?? (() => new Promise<void>((r) => requestAnimationFrame(() => r())));

  let generation = 0;
  let cancelCurrent: (() => void) | null = null;

  function check(gen: number, aborted: () => boolean): void {
    if (gen !== generation || aborted()) throw new Aborted();
  }

  async function settle(container: HTMLElement | null, gen: number, aborted: () => boolean): Promise<void> {
    const target = container ?? document.scrollingElement;
    const start = now();
    let last = target?.scrollTop ?? 0;
    let still = 0;
    while (now() - start < SCROLL_SETTLE_MS && still < SCROLL_SETTLE_FRAMES) {
      await nextFrame();
      check(gen, aborted);
      const top = target?.scrollTop ?? 0;
      still = top === last ? still + 1 : 0;
      last = top;
    }
  }

  async function scrollTo(r: Resolution, gen: number, aborted: () => boolean): Promise<NavResult> {
    deps.onPhase?.('scrolling');
    r.node.scrollIntoView({ behavior: deps.reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    await settle(deps.adapter.getScrollContainer(), gen, aborted);
    deps.onPhase?.('highlight');
    deps.highlight(r.node);
    return { status: 'found', resolution: r };
  }

  function ordinalWindow(): { min: number; max: number } {
    return { min: 0, max: Math.max(0, deps.identity.nodeCount() - 1) };
  }

  async function recover(pin: PinTarget, gen: number, aborted: () => boolean): Promise<NavResult> {
    const container = deps.adapter.getScrollContainer();
    if (!container) return { status: 'not-found', reason: 'no-scroll-container' };
    const start = now();
    const { min, max } = ordinalWindow();
    // A pin beyond the rendered window is most likely further down; otherwise sweep up first
    // (older, unmounted turns) and turn around at the top ("bidirectional", EDGE_CASES §2).
    let direction: 'up' | 'down' = pin.ordinal > max ? 'down' : 'up';
    let triedUp = direction === 'up';
    let triedDown = direction === 'down';
    let olderFailed = false;
    const step = Math.max(1, container.clientHeight * RECOVERY_STEP_RATIO);

    for (let attempt = 0; attempt < RECOVERY_MAX_STEPS && now() - start < RECOVERY_BUDGET_MS; attempt++) {
      const before = container.scrollTop;
      container.scrollTop = before + (direction === 'up' ? -step : step);
      await nextFrame();
      await sleep(RECOVERY_STEP_WAIT_MS);
      check(gen, aborted);
      deps.reconcile();
      const hit = deps.identity.resolve(pin);
      if (hit) return scrollTo(hit, gen, aborted);

      const atTop = container.scrollTop <= 0;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      const stuck = container.scrollTop === before;
      if (direction === 'up' && (atTop || stuck)) {
        if (deps.adapter.requestOlderMessages && (await deps.adapter.requestOlderMessages())) {
          check(gen, aborted);
          continue;
        }
        olderFailed = true;
        if (triedDown) break;
        direction = 'down';
        triedDown = true;
      } else if (direction === 'down' && (atBottom || stuck)) {
        if (triedUp) break;
        direction = 'up';
        triedUp = true;
      }
    }
    if (olderFailed && pin.ordinal < min) return { status: 'not-found', reason: 'not-loaded' };
    if (pin.ordinal > max + 1) return { status: 'not-found', reason: 'branch' };
    return { status: 'not-found', reason: 'exhausted' };
  }

  async function goTo(pin: PinTarget): Promise<NavResult> {
    cancelCurrent?.();
    const gen = ++generation;
    let userAborted = false;
    const aborted = (): boolean => userAborted;
    const container = deps.adapter.getScrollContainer();
    const savedTop = container?.scrollTop ?? 0;

    const onUser = (e: Event): void => {
      if (e instanceof KeyboardEvent && !ABORT_KEYS.has(e.key)) return;
      userAborted = true;
    };
    const listen = (): void => {
      addEventListener('wheel', onUser, { capture: true, passive: true });
      addEventListener('touchstart', onUser, { capture: true, passive: true });
      addEventListener('keydown', onUser, { capture: true });
    };
    const unlisten = (): void => {
      removeEventListener('wheel', onUser, { capture: true });
      removeEventListener('touchstart', onUser, { capture: true });
      removeEventListener('keydown', onUser, { capture: true });
    };
    cancelCurrent = () => {
      userAborted = true;
    };

    deps.clearHighlight();
    try {
      const direct = deps.identity.resolve(pin);
      if (direct) return await scrollTo(direct, gen, aborted);
      deps.onPhase?.('locating');
      listen();
      const result = await recover(pin, gen, aborted);
      if (result.status === 'not-found' && container) container.scrollTop = savedTop;
      return result;
    } catch (err) {
      if (!(err instanceof Aborted)) throw err;
      // Superseded by a newer navigation or a teardown: leave the scroll position to it.
      if (container && gen === generation) container.scrollTop = savedTop;
      return { status: 'aborted' };
    } finally {
      unlisten();
      if (gen === generation) cancelCurrent = null;
    }
  }

  return {
    goTo,
    /** Abort any in-flight navigation (thread change, teardown). */
    abort(): void {
      cancelCurrent?.();
      generation++;
    },
  };
}

export type Navigator = ReturnType<typeof createNavigator>;
