/**
 * Engine → overlay state (ARCHITECTURE.md I2: the overlay renders from state and emits
 * intents). A minimal observable; the overlay adapts it to signals.
 */
import type { HostId, Pin, Settings, ThreadSummary } from '@shared/schema';
import type { Health } from './health';
import type { NotFoundReason } from './navigator';

export type NavState = 'idle' | 'locating' | 'not-found';

export interface PinView {
  pin: Pin;
  /** Another live message has identical text (EDGE_CASES.md §7). */
  duplicate: boolean;
  /** The target is currently in the live index. */
  resolvable: boolean;
  /** The target is on screen (IntersectionObserver). */
  inView: boolean;
  nav: NavState;
  notFoundReason: NotFoundReason | null;
}

export type ToastKind = 'neutral' | 'success' | 'danger';
export type ToastAction = 'undo' | 'retry' | 'export' | 'reload';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action: ToastAction | null;
}

export type EngineStatus = 'booting' | 'running' | 'disabled' | 'stopped' | 'version-mismatch';

export interface StorageHealth {
  level: 'ok' | 'warn' | 'block';
  readOnly: boolean;
  quarantined: number;
}

export interface EngineState {
  status: EngineStatus;
  hostId: HostId;
  /** Origin label for the "All chats" rows (e.g. "claude.ai"); never message content. */
  hostLabel: string;
  threadId: string | null;
  transient: boolean;
  pins: PinView[];
  threads: ThreadSummary[];
  health: Health;
  storage: StorageHealth | null;
  settings: Settings;
  toast: Toast | null;
  sidebarOpen: boolean;
  /** Incremented to ask the overlay to focus the filter input. */
  focusFilterTick: number;
  /** Show the first-run tooltip anchored to this rect (viewport coords). */
  firstRunAnchor: { x: number; y: number } | null;
  /** Screen-reader announcement for the overlay's live region (UI_SPEC.md §14). */
  announcement: { id: number; text: string } | null;
  /** A host modal dialog is open: collapse and fade the handle (UI_SPEC.md §9). */
  hostModal: boolean;
  /** The page is fullscreen: hide the overlay entirely (EDGE_CASES.md §10). */
  fullscreen: boolean;
  dir: 'ltr' | 'rtl';
}

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  update(fn: (current: T) => Partial<T>): void;
  subscribe(listener: (state: T) => void): () => void;
}

export function createStateStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T) => void>();
  const emit = (): void => {
    for (const l of [...listeners]) {
      try {
        l(state);
      } catch {
        // A broken subscriber must not break the engine (R11).
      }
    }
  };
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      emit();
    },
    update(fn) {
      state = { ...state, ...fn(state) };
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
