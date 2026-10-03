/**
 * Last-resort structural adapter (ADAPTERS.md §6). Never used silently for a known host:
 * the registry only reaches it through `withFallback`, which health.ts reports as degraded.
 */
import { GENERIC_MIN_MESSAGE_CHARS, GENERIC_MIN_REPEATS } from '@shared/constants';
import { extractText, findButtonRow, findScrollableAncestor } from './dom-utils';
import { probeAdapter, scrollUpForOlder } from './base';
import { createSelectorSet, t1, t3 } from './selectors';
import type { HostAdapter, MountPoint } from './types';

export const GENERIC_SELECTORS_VERSION = '2026.10.1';

/** Tag plus child-tag shape: siblings that repeat it ≥ GENERIC_MIN_REPEATS times are turns. */
function signature(el: Element): string {
  return `${el.tagName}>${[...el.children].map((c) => c.tagName).join(',')}`;
}

function clusterRepeated(root: ParentNode): Element[] {
  let best: Element[] = [];
  const scan = (parent: Element): void => {
    const groups = new Map<string, Element[]>();
    for (const child of parent.children) {
      const key = signature(child);
      const group = groups.get(key) ?? [];
      group.push(child);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length >= GENERIC_MIN_REPEATS && group.length > best.length) best = group;
    }
    for (const child of parent.children) scan(child);
  };
  for (const el of root instanceof Element ? [root] : [...root.children]) scan(el);
  return best;
}

const longEnough = (el: Element): boolean =>
  el instanceof HTMLElement && extractText(el).length >= GENERIC_MIN_MESSAGE_CHARS;

const q = createSelectorSet('generic', {
  observerRoot: { tiers: [t1('[role="main"]'), t1('main'), t3(() => [document.body])] },
  messageNode: {
    tiers: [
      t3((root) => [...root.querySelectorAll('[role="article"], [role="listitem"], article')].filter(longEnough)),
      t3((root) => clusterRepeated(root).filter(longEnough)),
    ],
  },
});

function messageNodes(): HTMLElement[] {
  const root = q.one('observerRoot') ?? document.body;
  const nodes = q.all('messageNode', root);
  // Keep only outermost matches so nested articles are not counted twice.
  return nodes.filter((n) => !nodes.some((other) => other !== n && other.contains(n)));
}

export function createGenericAdapter(): HostAdapter {
  const adapter: Omit<HostAdapter, 'probe'> = {
    id: 'generic',
    matches: () => true,
    getObserverRoot: () => q.one('observerRoot'),
    getScrollContainer() {
      const first = messageNodes()[0];
      return first ? findScrollableAncestor(first) : null;
    },
    listMessageNodes: messageNodes,
    getRole(node) {
      const index = messageNodes().indexOf(node);
      if (index < 0) return 'unknown';
      return index % 2 === 0 ? 'user' : 'assistant';
    },
    getNativeId: () => null,
    getText: (node) => extractText(node),
    getActionBarMount(node): MountPoint | null {
      const row = findButtonRow(node);
      return row ? { container: row, position: 'append', styleHint: 'icon-ghost' } : null;
    },
    getThreadId(loc) {
      const last = loc.pathname.split('/').filter(Boolean).pop() ?? '';
      return /^[0-9a-f-]{8,}$/i.test(last) ? `generic:${last}` : null;
    },
    getThreadTitle: () => (document.title.trim() || null),
    requestOlderMessages() {
      return scrollUpForOlder(adapter.getScrollContainer(), () => messageNodes().length);
    },
  };
  return { ...adapter, probe: () => probeAdapter(adapter) };
}

export const genericAdapter = createGenericAdapter();
export const genericSelectors = q;
