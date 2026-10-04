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
  SCROLL_START_GRACE_FRAMES,
} from '@shared/constants';
import type { HostAdapter } from '@content/adapters/types';
import type { Identity, PinTarget, Resolution } from './identity';

export type NotFoundReason = 'exhausted' | 'no-scroll-container' | 'not-loaded' | 'offline' | 'branch';

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
  /** Network state; older turns the host must re-fetch cannot load offline (EDGE_CASES §21). */
  online?: () => boolean;
}

class Aborted extends Error {}

type Side = 'up' | 'down';
const other = (side: Side): Side => (side === 'up' ? 'down' : 'up');

const ABORT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export function createNavigator(deps: NavigatorDeps) {
  const now = deps.now ?? (() => performance.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const online = deps.online ?? (() => navigator.onLine);
  const nextFrame = deps.nextFrame ?? (() => new Promise<void>((r) => requestAnimationFrame(() => r())));

  let generation = 0;
  let cancelCurrent: (() => void) | null = null;

  function check(gen: number, aborted: () => boolean): void {
    if (gen !== generation || aborted()) throw new Aborted();
  }

  /**
   * Wait until the target stops moving. Tracks the node's own position so container and window
   * scrolling both count. A smooth scroll may not move for a few frames, and can stall for a
   * frame or two mid-way, so once it has moved we also wait for `scrollend` where supported.
   */
  async function settle(node: HTMLElement, gen: number, aborted: () => boolean): Promise<void> {
    const hasScrollEnd = typeof window !== 'undefined' && 'onscrollend' in window;
    let ended = false;
    const onEnd = (): void => {
      ended = true;
    };
    if (hasScrollEnd) document.addEventListener('scrollend', onEnd, { capture: true });
    try {
      const start = now();
      let last = node.getBoundingClientRect().top;
      let still = 0;
      let frames = 0;
      let moved = false;
      while (now() - start < SCROLL_SETTLE_MS) {
        await nextFrame();
        check(gen, aborted);
        frames++;
        const top = node.getBoundingClientRect().top;
        if (top === last) still++;
        else {
          still = 0;
          moved = true;
        }
        last = top;
        if (still < SCROLL_SETTLE_FRAMES) continue;
        if (moved ? ended || !hasScrollEnd : frames >= SCROLL_START_GRACE_FRAMES) return;
      }
    } finally {
      if (hasScrollEnd) document.removeEventListener('scrollend', onEnd, { capture: true });
    }
  }

  async function scrollTo(r: Resolution, gen: number, aborted: () => boolean): Promise<NavResult> {
    deps.onPhase?.('scrolling');
    r.node.scrollIntoView({ behavior: deps.reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    await settle(r.node, gen, aborted);
    deps.onPhase?.('highlight');
    deps.highlight(r.node);
    return { status: 'found', resolution: r };
  }

  function ordinalWindow(): { min: number; max: number } {
    return { min: 0, max: Math.max(0, deps.identity.nodeCount() - 1) };
  }

  /**
   * Sweep step (D-019): move so the edge of what the virtualiser has mounted lands just inside
   * the new viewport. The viewport itself is always mounted, so consecutive windows never leave
   * a gap; with overscan the step grows well past the spec's 0.8 viewport, which is the floor.
   */
  function stepFor(container: HTMLElement, direction: Side, minStep: number): number {
    const nodes = deps.adapter.listMessageNodes();
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return minStep;
    const box = container.getBoundingClientRect();
    const overlap = container.clientHeight - minStep;
    const reach =
      direction === 'up'
        ? box.bottom - first.getBoundingClientRect().top - overlap
        : last.getBoundingClientRect().bottom - box.top - overlap;
    return Math.max(minStep, reach);
  }

  async function recover(pin: PinTarget, gen: number, aborted: () => boolean): Promise<NavResult> {
    const container = deps.adapter.getScrollContainer();
    if (!container) return { status: 'not-found', reason: 'no-scroll-container' };
    const start = now();
    const { min, max } = ordinalWindow();
    // Zig-zag outward from where the user is (D-019): alternate between extending the explored
    // range upward and downward, so a pin is found after about twice its distance whichever side
    // it is on. A pin beyond the rendered window is most likely below, so that side goes first.
    const minStep = Math.max(1, container.clientHeight * RECOVERY_STEP_RATIO);
    const frontier = { up: container.scrollTop, down: container.scrollTop };
    const reach = { up: stepFor(container, 'up', minStep), down: stepFor(container, 'down', minStep) };
    const done = { up: false, down: false };
    let direction: Side = pin.ordinal > max ? 'down' : 'up';
    let olderFailed = false;

    for (let attempt = 0; attempt < RECOVERY_MAX_STEPS && now() - start < RECOVERY_BUDGET_MS; attempt++) {
      if (done[direction]) direction = other(direction);
      if (done[direction]) break;
      const before = frontier[direction];
      container.scrollTop = before + (direction === 'up' ? -reach.up : reach.down);
      await nextFrame();
      await sleep(RECOVERY_STEP_WAIT_MS);
      check(gen, aborted);
      deps.reconcile();
      const hit = deps.identity.resolve(pin);
      if (hit) return scrollTo(hit, gen, aborted);

      const top = container.scrollTop;
      frontier[direction] = top;
      reach[direction] = stepFor(container, direction, minStep);
      const stuck = top === before;
      if (direction === 'up' && (top <= 0 || stuck)) {
        if (deps.adapter.requestOlderMessages && (await deps.adapter.requestOlderMessages())) {
          check(gen, aborted);
          frontier.up = container.scrollTop; // prepended turns shift positions; rescan from here
          continue;
        }
        olderFailed = true;
        done.up = true;
      } else if (direction === 'down' && (top + container.clientHeight >= container.scrollHeight - 1 || stuck)) {
        done.down = true;
      }
      direction = other(direction);
    }
    if (olderFailed && !online()) return { status: 'not-found', reason: 'offline' };
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
