/**
 * Page conditions the overlay must defer to (UI_SPEC.md §9, EDGE_CASES.md §10): an open host
 * modal dialog and fullscreen. Generic ARIA only — no host selectors. The core owns this so
 * the overlay never reads host DOM (I2).
 */
export interface PageConditions {
  hostModal: boolean;
  fullscreen: boolean;
  dir: 'ltr' | 'rtl';
}

const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], dialog[open]';

export function readPageConditions(): PageConditions {
  const modal = [...document.querySelectorAll(MODAL_SELECTOR)].some(
    (el) => !el.closest('#ai-pinpoint-root') && !el.hasAttribute('hidden'),
  );
  const dir = (document.documentElement.getAttribute('dir') ?? document.body?.getAttribute('dir') ?? '').toLowerCase();
  return { hostModal: modal, fullscreen: document.fullscreenElement != null, dir: dir === 'rtl' ? 'rtl' : 'ltr' };
}

/**
 * Host dialogs are portalled into <body>; watch its direct children plus attribute flips on
 * existing dialogs. Not a subtree observer on the thread — streaming churn never reaches it.
 */
export function watchPage(onChange: (c: PageConditions) => void): () => void {
  let last = readPageConditions();
  onChange(last);
  const check = (): void => {
    const next = readPageConditions();
    if (next.hostModal !== last.hostModal || next.fullscreen !== last.fullscreen || next.dir !== last.dir) {
      last = next;
      onChange(next);
    }
  };
  const mo = new MutationObserver(check);
  if (document.body) mo.observe(document.body, { childList: true });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
  document.addEventListener('fullscreenchange', check);
  return () => {
    mo.disconnect();
    document.removeEventListener('fullscreenchange', check);
  };
}
