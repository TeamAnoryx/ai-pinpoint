/**
 * ChatGPT adapter (ADAPTERS.md §4, survey D-011). `[data-message-id]` is a stable UUID, so
 * identity here is id-first. The action row lives on the turn wrapper, not the message.
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
import { createSelectorSet, t1, t2, t4 } from './selectors';
import type { HostAdapter, MountPoint } from './types';

export const CHATGPT_SELECTORS_VERSION = '2026.10.1';

const TURN_WRAPPER = 'section[data-turn], [data-testid^="conversation-turn"], article';
const TEXT_EXCLUSIONS = ['h4', '[class*="sr-only"]', '[role="group"]'];

const q = createSelectorSet('chatgpt', {
  observerRoot: {
    tiers: [t2('#thread'), t1('[role="main"]'), t1('main'), t4('[class*="thread"]')],
  },
  messageNode: {
    tiers: [
      t2('[data-message-id]'),
      t2('[data-message-author-role]'),
      t2('[data-testid^="conversation-turn"]'),
      t1('main article'),
    ],
  },
  actionGroup: { tiers: [t1('[role="group"]')] },
  composerStop: { tiers: [t2('[data-testid="stop-button"]')] },
  composerSend: { tiers: [t2('[data-testid="send-button"]'), t2('#prompt-textarea')] },
});

function roleOf(node: HTMLElement): 'user' | 'assistant' | 'unknown' {
  const own = node.closest('[data-message-author-role]')?.getAttribute('data-message-author-role');
  const role = own ?? node.closest('[data-turn]')?.getAttribute('data-turn');
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  return 'unknown';
}

function turnOf(node: HTMLElement): HTMLElement {
  const turn = node.parentElement?.closest<HTMLElement>(TURN_WRAPPER);
  return turn ?? node;
}

const textOf = (node: HTMLElement): string => extractText(node, TEXT_EXCLUSIONS);

export function createChatgptAdapter(opts: AdapterOptions = {}): HostAdapter {
  const sampler = samplerFor(opts);

  const adapter: Omit<HostAdapter, 'probe'> = {
    id: 'chatgpt',

    matches: (loc) => loc.hostname === 'chatgpt.com' || loc.hostname === 'chat.openai.com',

    getObserverRoot: () => q.one('observerRoot'),

    getScrollContainer() {
      const first = q.one('messageNode');
      return first ? findScrollableAncestor(first) : null;
    },

    listMessageNodes: () => q.all('messageNode'),

    getRole: roleOf,

    getNativeId: (node) => node.getAttribute('data-message-id'),

    getText: textOf,

    getActionBarMount(node): MountPoint | null {
      const turn = turnOf(node);
      const group = q.all('actionGroup', turn).find((g) => !node.contains(g));
      const row = group ?? findButtonRow(turn, ['[data-message-id]']);
      return row ? { container: row, position: 'append', styleHint: 'icon-ghost' } : null;
    },

    getThreadId(loc) {
      const id = pathId(loc, /\/c\/([0-9a-f-]{8,})/i);
      return id ? `chatgpt:${id}` : null;
    },

    getThreadTitle: () => titleWithout(/(?:^|\s*[-–|]\s*)ChatGPT\s*$/i),

    isStreaming(node) {
      const nodes = q.all('messageNode');
      const isTail = (n: HTMLElement): boolean => roleOf(n) === 'assistant';
      if (q.one('composerStop')) {
        return [...nodes].reverse().find(isTail) === node;
      }
      // A send control without a stop control is a definitive "idle" composer.
      if (q.one('composerSend')) return false;
      return tailIsStreaming(sampler, node, nodes, isTail, textOf);
    },

    requestOlderMessages() {
      return scrollUpForOlder(adapter.getScrollContainer(), () => q.all('messageNode').length);
    },
  };

  return { ...adapter, probe: () => probeAdapter(adapter) };
}

export const chatgptAdapter = createChatgptAdapter();
export const chatgptSelectors = q;
