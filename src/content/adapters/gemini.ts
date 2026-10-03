/**
 * Gemini adapter (ADAPTERS.md §3, survey D-011). Angular custom elements give us durable
 * tier-2 hooks: `user-query`, `model-response`, `message-content`, `message-actions`.
 */
import { extractText, findButtonRow, findScrollableAncestor } from './dom-utils';
import {
  type AdapterOptions,
  pathId,
  probeAdapter,
  samplerFor,
  scrollUpForOlder,
  tailIsStreaming,
  titleWithout,
} from './base';
import { createSelectorSet, t1, t2, t3, t4 } from './selectors';
import type { HostAdapter, MountPoint } from './types';

export const GEMINI_SELECTORS_VERSION = '2026.10.1';

const TURN_ID = /^[0-9a-f]{12,}$/i;

/** Screen-reader labels, thoughts, sources, and suggestion chips are not message text. */
const MODEL_EXCLUSIONS = [
  'h6',
  'model-thoughts',
  'sources-list',
  '[class*="visually-hidden"]',
  '[class*="thoughts"]',
  '[class*="suggest"]',
];
const USER_EXCLUSIONS = ['h5', '[class*="visually-hidden"]'];
/** Code-block toolbars live inside the message; never mistake them for the action row. */
const ROW_IGNORE = ['code-block', '[class*="code-block"]'];

function turnChildren(root: ParentNode): Element[] {
  const turns = [...root.querySelectorAll('[id]')].filter((el) => TURN_ID.test(el.id));
  return turns.flatMap((turn) => [...turn.children].slice(0, 2));
}

const q = createSelectorSet('gemini', {
  observerRoot: {
    tiers: [
      t2('infinite-scroller[data-test-id="chat-history-container"]'),
      t2('chat-window'),
      t1('[role="main"]'),
      t1('main'),
      t4('[class*="chat-window"]'),
    ],
  },
  scroller: {
    tiers: [t2('[data-test-id="chat-history-container"]'), t2('infinite-scroller')],
  },
  messageNode: {
    tiers: [
      t2('user-query, model-response'),
      t3(turnChildren),
      t4('[class*="user-query"], [class*="model-response"]'),
    ],
  },
  modelText: { tiers: [t2('message-content'), t4('[class*="markdown"]')] },
  modelActions: { tiers: [t2('message-actions'), t4('[class*="actions-container"]')] },
});

function roleOf(node: HTMLElement): 'user' | 'assistant' | 'unknown' {
  const tag = node.tagName.toLowerCase();
  if (tag === 'user-query' || /user-query/.test(node.className)) return 'user';
  if (tag === 'model-response' || /model-response/.test(node.className)) return 'assistant';
  // Tier-3 fallback: first child of a turn is the query, second the response.
  const parent = node.parentElement;
  if (parent && TURN_ID.test(parent.id)) {
    return parent.firstElementChild === node ? 'user' : 'assistant';
  }
  return 'unknown';
}

function textOf(node: HTMLElement): string {
  if (roleOf(node) === 'user') return extractText(node, USER_EXCLUSIONS);
  const body = q.one('modelText', node);
  return body ? extractText(body, MODEL_EXCLUSIONS) : extractText(node, MODEL_EXCLUSIONS);
}

export function createGeminiAdapter(opts: AdapterOptions = {}): HostAdapter {
  const sampler = samplerFor(opts);

  const adapter: Omit<HostAdapter, 'probe'> = {
    id: 'gemini',

    matches: (loc) => loc.hostname === 'gemini.google.com' || loc.hostname === 'bard.google.com',

    getObserverRoot: () => q.one('observerRoot'),

    getScrollContainer() {
      const own = q.one('scroller');
      if (own) return own;
      const first = q.one('messageNode');
      return first ? findScrollableAncestor(first) : null;
    },

    listMessageNodes: () => q.all('messageNode'),

    getRole: roleOf,

    getNativeId(node) {
      const turn = node.parentElement;
      if (!turn || !TURN_ID.test(turn.id)) return null;
      const role = roleOf(node);
      return role === 'unknown' ? null : `${turn.id}:${role}`;
    },

    getText: textOf,

    getActionBarMount(node): MountPoint | null {
      const scope = roleOf(node) === 'assistant' ? (q.one('modelActions', node) ?? node) : node;
      const row = findButtonRow(scope, ROW_IGNORE);
      return row ? { container: row, position: 'append', styleHint: 'icon-ghost' } : null;
    },

    getThreadId(loc) {
      const id = pathId(loc, /\/app\/([A-Za-z0-9_-]{6,})/);
      return id ? `gemini:${id}` : null;
    },

    getThreadTitle() {
      const title = titleWithout(/(?:^|\s*[-–|]\s*)(?:Google\s+)?Gemini\s*$/i);
      if (title) return title;
      const firstUser = q.all('messageNode').find((n) => roleOf(n) === 'user');
      return firstUser ? textOf(firstUser) || null : null;
    },

    isStreaming(node) {
      if (node.querySelector('[aria-busy="true"]') || node.getAttribute('aria-busy') === 'true') return true;
      return tailIsStreaming(sampler, node, q.all('messageNode'), (n) => roleOf(n) === 'assistant', textOf);
    },

    requestOlderMessages() {
      return scrollUpForOlder(adapter.getScrollContainer(), () => q.all('messageNode').length);
    },
  };

  return { ...adapter, probe: () => probeAdapter(adapter) };
}

export const geminiAdapter = createGeminiAdapter();
export const geminiSelectors = q;
