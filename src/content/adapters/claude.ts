/**
 * Claude adapter (ADAPTERS.md §5, survey D-011). The transcript is virtualised; each
 * `[role="article"]` row is one message and carries `data-turn-key` (a native id). Reasoning
 * disclosures and artifact cards are excluded from text so hashes do not change when the
 * user expands them or an artifact loads (mandatory for identity stability).
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

export const CLAUDE_SELECTORS_VERSION = '2026.10.1';

const TEXT_EXCLUSIONS = [
  '[data-find-omitted]',
  '[data-sheet-kind]',
  '[data-testid="file-card-open"]',
  '[data-testid="message-actions"]',
  '[class*="sr-only"]',
];

const q = createSelectorSet('claude', {
  observerRoot: {
    tiers: [t2('[data-testid="transcript-list"]'), t1('[role="main"]'), t1('main')],
  },
  scroller: { tiers: [t2('[data-autoscroll-container]')] },
  messageNode: {
    tiers: [
      t1('[data-testid="transcript-row"] [role="article"]'),
      t2('[data-turn-key]'),
      t2('[data-testid="user-message"], [data-testid="assistant-message"]'),
      t4('[class*="font-claude-message"], [class*="font-user-message"]'),
    ],
  },
  userBody: { tiers: [t2('[data-testid="user-message"]'), t4('[class*="font-user-message"]')] },
  assistantBody: {
    tiers: [t2('[data-testid="assistant-message"]'), t4('[class*="font-claude-message"]')],
  },
  assistantActions: { tiers: [t2('[data-testid="message-actions"]')] },
});

function roleOf(node: HTMLElement): 'user' | 'assistant' | 'unknown' {
  if (q.one('userBody', node) || node.matches('[data-testid="user-message"]')) return 'user';
  if (q.one('assistantBody', node) || node.matches('[data-testid="assistant-message"]')) return 'assistant';
  const key = node.getAttribute('data-turn-key');
  if (key) return key.endsWith('-hub-reply') ? 'assistant' : 'user';
  return 'unknown';
}

/**
 * Remove reasoning disclosures: for each `[aria-expanded]` toggle, drop the top-level block of
 * the message body that contains it. The reply prose is a sibling block, so it survives
 * whether the disclosure is collapsed or expanded.
 */
function withoutDisclosures(body: HTMLElement): HTMLElement {
  const clone = body.cloneNode(true) as HTMLElement;
  for (const toggle of [...clone.querySelectorAll('[aria-expanded]')]) {
    let block: Element = toggle;
    while (block.parentElement && block.parentElement !== clone) block = block.parentElement;
    // Already-removed blocks climb to a detached root; removing that again is a no-op.
    if (block.parentElement === clone) block.remove();
  }
  return clone;
}

function textOf(node: HTMLElement): string {
  const role = roleOf(node);
  const body =
    (role === 'user' ? q.one('userBody', node) : q.one('assistantBody', node)) ??
    (node.matches('[data-testid]') ? node : null) ??
    node;
  const source = role === 'assistant' ? withoutDisclosures(body) : body;
  return extractText(source, TEXT_EXCLUSIONS);
}

export function createClaudeAdapter(opts: AdapterOptions = {}): HostAdapter {
  const sampler = samplerFor(opts);

  const adapter: Omit<HostAdapter, 'probe'> = {
    id: 'claude',

    matches: (loc) => loc.hostname === 'claude.ai',

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
      const holder = node.closest('[data-turn-key]') ?? node.querySelector('[data-turn-key]');
      return holder?.getAttribute('data-turn-key') ?? null;
    },

    getText: textOf,

    getActionBarMount(node): MountPoint | null {
      const own = q.one('assistantActions', node);
      const row =
        (own && (findButtonRow(own) ?? (own.querySelector('button') ? own : null))) ??
        findButtonRow(node, ['[data-sheet-kind]', '[aria-expanded]']);
      // User turns often expose only a hover edit control; null selects the floating path.
      return row ? { container: row, position: 'append', styleHint: 'icon-ghost' } : null;
    },

    getThreadId(loc) {
      const id = pathId(loc, /\/chat\/([0-9a-f-]{8,})/i);
      return id ? `claude:${id}` : null;
    },

    getThreadTitle: () => titleWithout(/(?:^|\s*[-–|]\s*)Claude\s*$/i),

    isStreaming(node) {
      const body = q.one('assistantBody', node);
      const flag = body?.getAttribute('data-is-streaming');
      if (flag === 'true') return true;
      if (flag === 'false') return false;
      return tailIsStreaming(sampler, node, q.all('messageNode'), (n) => roleOf(n) === 'assistant', textOf);
    },

    requestOlderMessages() {
      return scrollUpForOlder(adapter.getScrollContainer(), () => q.all('messageNode').length);
    },
  };

  return { ...adapter, probe: () => probeAdapter(adapter) };
}

export const claudeAdapter = createClaudeAdapter();
export const claudeSelectors = q;
