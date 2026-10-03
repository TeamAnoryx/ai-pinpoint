/**
 * Per-node pin-button lifecycle for the engine: mount at the adapter's action row, fall back
 * to a floating button in our layer, re-mount when the host re-renders the row, and keep
 * the pressed state in sync with the pin list (ADAPTERS.md §8).
 */
import type { HostAdapter } from '@content/adapters/types';
import { createFloatingButtons } from '@content/inject/highlight';
import {
  createPinButton,
  mountPinButton,
  removeInjected,
  setPinState,
  type PinState,
} from '@content/inject/pin-button';

export interface ButtonEnv {
  dark(): boolean;
  reducedMotion(): boolean;
  hotkeyHint: string;
}

export function createButtonManager(
  adapter: HostAdapter,
  layer: HTMLElement,
  env: ButtonEnv,
  onActivate: (node: HTMLElement) => void,
) {
  const byNode = new Map<HTMLElement, HTMLButtonElement>();
  const nodeOf = new WeakMap<HTMLButtonElement, HTMLElement>();
  const floating = createFloatingButtons(layer);
  let mounted = 0;

  const opts = () => ({ dark: env.dark(), reducedMotion: env.reducedMotion(), hotkeyHint: env.hotkeyHint });

  function make(node: HTMLElement, hash: string, state: PinState, styleHint: 'icon-ghost' | 'icon-solid' | 'floating'): HTMLButtonElement {
    const btn = createPinButton({
      ...opts(),
      hash,
      state,
      styleHint,
      onActivate: (b) => {
        const target = nodeOf.get(b);
        if (target) onActivate(target);
      },
    });
    nodeOf.set(btn, node);
    return btn;
  }

  /** Ensure `node` has a live button in the right state. Returns whether it is in a host row. */
  function ensure(node: HTMLElement, hash: string, state: PinState): boolean {
    const existing = byNode.get(node);
    if (existing?.isConnected) {
      if (existing.dataset['pinpointState'] !== state) setPinState(existing, state, opts());
      existing.dataset['pinpointHash'] = hash;
      return floating.get(node) !== existing;
    }
    const mp = adapter.getActionBarMount(node);
    const btn = make(node, hash, state, mp?.styleHint ?? 'floating');
    byNode.set(node, btn);
    if (mp && mp.styleHint !== 'floating') {
      floating.detach(node);
      mountPinButton(mp, btn);
      mounted++;
      return true;
    }
    floating.attach(node, btn);
    return false;
  }

  function setState(node: HTMLElement, state: PinState): void {
    const btn = byNode.get(node);
    if (btn && btn.dataset['pinpointState'] !== state) setPinState(btn, state, opts());
  }

  /** Forget nodes the host unmounted (virtualisation) so they can be collected. */
  function prune(): void {
    for (const [node, btn] of byNode) {
      if (!node.isConnected) {
        btn.remove();
        byNode.delete(node);
      }
    }
    floating.prune();
  }

  return {
    ensure,
    setState,
    prune,
    buttonFor: (node: HTMLElement): HTMLButtonElement | undefined => byNode.get(node),
    /** Number of mounts into host rows since start (health + tests). */
    mountedCount: (): number => mounted,
    floatingCount: (): number => floating.count(),
    destroy(): void {
      floating.destroy();
      for (const btn of byNode.values()) btn.remove();
      byNode.clear();
      removeInjected(document);
    },
  };
}

export type ButtonManager = ReturnType<typeof createButtonManager>;
