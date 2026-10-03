/**
 * Highlight ring and floating pin buttons, drawn in our own overlay layer — never as styles
 * on host nodes (UI_SPEC.md §5–§6, ARCHITECTURE.md §7). The layer is a fixed, full-viewport,
 * `pointer-events: none` element inside the closed shadow root.
 */
import {
  FLOATING_BUTTON_PX,
  FLOATING_INSET_PX,
  HIGHLIGHT_FADE_IN_MS,
  HIGHLIGHT_FADE_OUT_MS,
  HIGHLIGHT_OUTSET_PX,
  HIGHLIGHT_SCROLL_CANCEL_PX,
} from '@shared/constants';
import { ACCENT_DARK, ACCENT_LIGHT } from './pin-button';

export interface HighlightOptions {
  durationMs: number;
  reducedMotion: boolean;
  dark: boolean;
}

function place(el: HTMLElement, rect: DOMRect, outset: number): void {
  el.style.left = `${rect.left - outset}px`;
  el.style.top = `${rect.top - outset}px`;
  el.style.width = `${rect.width + outset * 2}px`;
  el.style.height = `${rect.height + outset * 2}px`;
}

/** rAF-throttled callback for scroll/resize. */
function throttled(fn: () => void): { run: () => void; cancel: () => void } {
  let frame: number | null = null;
  return {
    run: () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        fn();
      });
    },
    cancel: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}

export function createHighlighter(layer: HTMLElement) {
  let active: { el: HTMLElement; dispose: () => void } | null = null;

  function clear(): void {
    active?.dispose();
    active = null;
  }

  function show(target: HTMLElement, scroller: HTMLElement | null, opts: HighlightOptions): void {
    clear();
    const accent = opts.dark ? ACCENT_DARK : ACCENT_LIGHT;
    const el = document.createElement('div');
    el.setAttribute('data-pinpoint-ui', 'highlight');
    el.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'box-sizing:border-box',
      `border:2px solid ${accent}`,
      'border-radius:8px',
      `background:${accent}1a`,
    ].join(';');
    place(el, target.getBoundingClientRect(), HIGHLIGHT_OUTSET_PX);
    layer.append(el);

    if (!opts.reducedMotion && typeof el.animate === 'function') {
      el.animate([{ opacity: 0, transform: 'scale(1.02)' }, { opacity: 1, transform: 'scale(1)' }], {
        duration: HIGHLIGHT_FADE_IN_MS,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }

    const startTop = scroller?.scrollTop ?? 0;
    const reposition = throttled(() => {
      if (!target.isConnected) return clear();
      if (Math.abs((scroller?.scrollTop ?? 0) - startTop) > HIGHLIGHT_SCROLL_CANCEL_PX) return clear();
      place(el, target.getBoundingClientRect(), HIGHLIGHT_OUTSET_PX);
    });
    addEventListener('scroll', reposition.run, { capture: true, passive: true });
    addEventListener('resize', reposition.run, { passive: true });

    const holdMs = opts.reducedMotion ? opts.durationMs : Math.max(0, opts.durationMs - HIGHLIGHT_FADE_OUT_MS);
    let fade: ReturnType<typeof setTimeout> | null = null;
    const done = setTimeout(() => {
      if (opts.reducedMotion || typeof el.animate !== 'function') return clear();
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HIGHLIGHT_FADE_OUT_MS, fill: 'forwards' });
      fade = setTimeout(clear, HIGHLIGHT_FADE_OUT_MS);
    }, holdMs);

    active = {
      el,
      dispose: () => {
        clearTimeout(done);
        if (fade !== null) clearTimeout(fade);
        reposition.cancel();
        removeEventListener('scroll', reposition.run, { capture: true });
        removeEventListener('resize', reposition.run);
        el.remove();
      },
    };
  }

  return {
    show,
    clear,
    isActive: (): boolean => active !== null,
    destroy: clear,
  };
}

export type Highlighter = ReturnType<typeof createHighlighter>;

/**
 * Floating pin buttons for messages without an action row: drawn in the layer at the node's
 * top-right corner, positioned only while the node is visible (IntersectionObserver + rAF).
 * Each button sits in a positioned holder, so the button's own state styling (hover, focus,
 * pressed) can rewrite its style without moving it.
 */
export function createFloatingButtons(layer: HTMLElement) {
  const entries = new Map<HTMLElement, { btn: HTMLButtonElement; holder: HTMLElement }>();
  const visible = new Set<HTMLElement>();

  function position(node: HTMLElement, holder: HTMLElement): void {
    const r = node.getBoundingClientRect();
    holder.style.left = `${r.right - FLOATING_BUTTON_PX - FLOATING_INSET_PX}px`;
    holder.style.top = `${r.top + FLOATING_INSET_PX}px`;
  }

  const update = throttled(() => {
    for (const node of visible) {
      const entry = entries.get(node);
      if (entry) position(node, entry.holder);
    }
  });

  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((records) => {
          for (const rec of records) {
            const node = rec.target as HTMLElement;
            const entry = entries.get(node);
            if (!entry) continue;
            if (rec.isIntersecting) {
              visible.add(node);
              entry.holder.style.display = 'block';
              position(node, entry.holder);
            } else {
              visible.delete(node);
              entry.holder.style.display = 'none';
            }
          }
        })
      : null;

  let armed = false;
  const arm = (): void => {
    if (armed) return;
    armed = true;
    addEventListener('scroll', update.run, { capture: true, passive: true });
    addEventListener('resize', update.run, { passive: true });
  };

  function detach(node: HTMLElement): void {
    entries.get(node)?.holder.remove();
    entries.delete(node);
    visible.delete(node);
    io?.unobserve(node);
  }

  return {
    attach(node: HTMLElement, btn: HTMLButtonElement): void {
      if (entries.get(node)?.btn === btn) return;
      arm();
      detach(node);
      const holder = document.createElement('div');
      holder.setAttribute('data-pinpoint-ui', 'floating');
      holder.style.cssText = 'position:fixed;pointer-events:auto;z-index:1;line-height:0';
      holder.append(btn);
      entries.set(node, { btn, holder });
      layer.append(holder);
      if (io) io.observe(node);
      else {
        visible.add(node);
        position(node, holder);
      }
    },
    detach,
    get(node: HTMLElement): HTMLButtonElement | undefined {
      return entries.get(node)?.btn;
    },
    /** Drop entries whose node left the DOM (virtualised away). */
    prune(): void {
      for (const node of [...entries.keys()]) if (!node.isConnected) detach(node);
    },
    count: (): number => entries.size,
    /** Remove every button and listener; a later attach re-arms. */
    destroy(): void {
      io?.disconnect();
      update.cancel();
      armed = false;
      removeEventListener('scroll', update.run, { capture: true });
      removeEventListener('resize', update.run);
      for (const { holder } of entries.values()) holder.remove();
      entries.clear();
      visible.clear();
    },
  };
}

export type FloatingButtons = ReturnType<typeof createFloatingButtons>;
