/**
 * Overlay state: the engine's state mirrored into a signal, plus UI-local signals. The overlay
 * renders from this and calls engine intents; it never touches host DOM (I2).
 */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { signal, type Signal } from '@preact/signals';
import type { Engine } from '@content/core/engine';
import type { EngineState, Store } from '@content/core/state';

export type Intents = Engine['intents'] & {
  /** Open the extension's options page (handled by the service worker). */
  openOptions(): void;
  /** Write a snippet to the clipboard (write only — never read, NFR-11). */
  copyText(text: string): Promise<void>;
};

export type Tab = 'chat' | 'all';

export interface OverlayModel {
  engine: Signal<EngineState>;
  tab: Signal<Tab>;
  filter: Signal<string>;
  editing: Signal<string | null>;
  menu: Signal<string | null>;
  /** Health/storage banners dismissed for this session. */
  dismissed: Signal<ReadonlySet<string>>;
  /** Ticks every minute so relative times refresh. */
  now: Signal<number>;
  /** Live viewport width for narrow-sheet mode. */
  viewportWidth: Signal<number>;
}

export function createOverlayModel(store: Store<EngineState>): { model: OverlayModel; dispose: () => void } {
  const model: OverlayModel = {
    engine: signal(store.get()),
    tab: signal('chat'),
    filter: signal(''),
    editing: signal(null),
    menu: signal(null),
    dismissed: signal(new Set()),
    now: signal(Date.now()),
    viewportWidth: signal(typeof innerWidth === 'number' ? innerWidth : 1280),
  };
  const unsubscribe = store.subscribe((s) => {
    model.engine.value = s;
  });
  return { model, dispose: unsubscribe };
}

export interface OverlayContextValue {
  model: OverlayModel;
  intents: Intents;
}

export const OverlayContext = createContext<OverlayContextValue | null>(null);

export function useOverlay(): OverlayContextValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('overlay context missing');
  return ctx;
}
