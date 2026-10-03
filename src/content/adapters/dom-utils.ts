/**
 * Host-independent DOM helpers shared by every adapter (ADAPTERS.md §2).
 * Pure reads of host DOM; nothing here writes to the page.
 */
import {
  BUTTON_ROW_MAX_TEXT_CHARS,
  BUTTON_ROW_MIN_BUTTONS,
  DEEP_QUERY_MAX_DEPTH,
  DEEP_QUERY_NODE_BUDGET,
  SCROLLABLE_SLACK_PX,
  STREAM_SAMPLE_MS,
  STREAM_TIMEOUT_MS,
} from '@shared/constants';

/** Open shadow roots under a root, discovered once per synchronous task (bounded walk). */
let shadowCache = new WeakMap<ParentNode, ShadowRoot[]>();
let shadowCacheArmed = false;

function openShadowRoots(root: ParentNode): ShadowRoot[] {
  const hit = shadowCache.get(root);
  if (hit) return hit;
  const found: ShadowRoot[] = [];
  let budget = DEEP_QUERY_NODE_BUDGET;
  const visit = (scope: ParentNode, depth: number): void => {
    if (depth >= DEEP_QUERY_MAX_DEPTH) return;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n && budget > 0; n = walker.nextNode()) {
      budget--;
      const shadow = (n as Element).shadowRoot; // null for closed roots — never pierced
      if (shadow) {
        found.push(shadow);
        visit(shadow, depth + 1);
      }
    }
  };
  visit(root, 0);
  shadowCache.set(root, found);
  if (!shadowCacheArmed) {
    shadowCacheArmed = true;
    queueMicrotask(() => {
      shadowCache = new WeakMap();
      shadowCacheArmed = false;
    });
  }
  return found;
}

/**
 * querySelectorAll that falls back to searching open shadow roots (EDGE_CASES.md §11).
 * Shadow roots are only searched when the light DOM has no match, and are discovered once
 * per task: a full walk on every query would make per-node adapter calls O(n²).
 */
export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const out: Element[] = [...root.querySelectorAll(selector)];
  if (out.length > 0) return out;
  for (const shadow of openShadowRoots(root)) out.push(...shadow.querySelectorAll(selector));
  return out;
}

const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

/** First ancestor that actually scrolls; hosts scroll an inner div, not the document. */
export function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    const overflowY = getComputedStyle(cur).overflowY;
    if (SCROLLABLE_OVERFLOW.has(overflowY) && cur.scrollHeight > cur.clientHeight + SCROLLABLE_SLACK_PX) {
      return cur;
    }
  }
  const doc = document.scrollingElement ?? document.documentElement;
  return doc instanceof HTMLElement ? doc : null;
}

const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;
const WHITESPACE = /\s+/g;
/** Safety net for action labels a host renders as plain text instead of buttons. */
const TRAILING_ACTION_LABELS = /(?:\s+(?:copy|edit|regenerate|retry|share))+$/i;

export function normaliseText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(WHITESPACE, ' ')
    .trim()
    .replace(TRAILING_ACTION_LABELS, '')
    .trim();
}

/** Always stripped before reading text (EDGE_CASES.md §12). */
const ALWAYS_EXCLUDED = [
  'button',
  '[role="button"]',
  'svg',
  '[aria-hidden="true"]',
  '[hidden]',
  'script',
  'style',
  'noscript',
  'template',
  '[data-pinpoint-btn]',
  '[data-pinpoint-ui]',
];

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV',
  'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);

/**
 * Layout-independent text: unlike innerText it does not depend on hover state, CSS
 * visibility, or whether the node is on screen, so hashes stay stable.
 */
function readText(node: Node): string {
  const parts: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      parts.push(n.nodeValue ?? '');
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const block = BLOCK_TAGS.has((n as Element).tagName);
    if (block) parts.push('\n');
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
    if (block) parts.push('\n');
  };
  walk(node);
  return parts.join('');
}

/**
 * Message text with host chrome removed: clone, strip buttons/icons/hidden/our own nodes and
 * the adapter's exclusions (reasoning blocks, artifact cards, chips), then normalise.
 */
export function extractText(node: HTMLElement, exclusions: readonly string[] = []): string {
  const clone = node.cloneNode(true) as HTMLElement;
  for (const selector of [...ALWAYS_EXCLUDED, ...exclusions]) {
    try {
      for (const el of clone.querySelectorAll(selector)) el.remove();
    } catch {
      // A malformed adapter selector must not break extraction.
    }
  }
  return normaliseText(readText(clone));
}

const BUTTON_SELECTOR = 'button, [role="button"]';

function ownTextLength(el: Element): number {
  const clone = el.cloneNode(true) as Element;
  for (const b of clone.querySelectorAll(`${BUTTON_SELECTOR}, svg`)) b.remove();
  return normaliseText(clone.textContent ?? '').length;
}

function depthOf(el: Element, root: Element): number {
  let d = 0;
  for (let cur: Element | null = el; cur && cur !== root; cur = cur.parentElement) d++;
  return d;
}

/**
 * The host's action row (copy / thumbs / edit): the deepest element inside `node` holding at
 * least two buttons and no real text. `ignoreWithin` keeps code-block toolbars, artifact
 * cards, etc. from being mistaken for the message's row.
 */
export function findButtonRow(node: HTMLElement, ignoreWithin: readonly string[] = []): HTMLElement | null {
  const ignored = ['pre', 'code', '[data-pinpoint-ui]', ...ignoreWithin].join(', ');
  const insideIgnored = (b: Element): boolean => {
    const region = b.parentElement?.closest(ignored);
    return region !== null && region !== undefined && node.contains(region);
  };
  const buttons = [...node.querySelectorAll(BUTTON_SELECTOR)].filter(
    (b) => !b.closest('[data-pinpoint-btn]') && !insideIgnored(b),
  );
  if (buttons.length < BUTTON_ROW_MIN_BUTTONS) return null;

  let best: HTMLElement | null = null;
  let bestDepth = -1;
  const seen = new Set<Element>();
  for (const button of buttons) {
    for (let cur = button.parentElement; cur && node.contains(cur); cur = cur.parentElement) {
      if (seen.has(cur)) break;
      seen.add(cur);
      if (!(cur instanceof HTMLElement)) continue;
      const count = buttons.filter((b) => cur.contains(b) && b !== cur).length;
      if (count < BUTTON_ROW_MIN_BUTTONS) continue;
      if (ownTextLength(cur) > BUTTON_ROW_MAX_TEXT_CHARS) continue;
      const depth = depthOf(cur, node);
      if (depth > bestDepth) {
        best = cur;
        bestDepth = depth;
      }
    }
  }
  return best;
}

interface Sample {
  length: number;
  sampledAt: number;
  firstSeen: number;
}

/**
 * Generic streaming detector (EDGE_CASES.md §1): a node is "streaming" until two samples at
 * least STREAM_SAMPLE_MS apart see the same text length. After STREAM_TIMEOUT_MS from first
 * sight it is treated as finished regardless — the offline-correctness path, because a
 * stream cut by a disconnect never signals completion.
 */
export function createStreamSampler(now: () => number = () => performance.now()) {
  const samples = new WeakMap<Element, Sample>();
  return function isElementStreaming(node: HTMLElement, textLength = (node.textContent ?? '').length): boolean {
    const t = now();
    const prev = samples.get(node);
    if (!prev) {
      samples.set(node, { length: textLength, sampledAt: t, firstSeen: t });
      return true;
    }
    if (t - prev.firstSeen >= STREAM_TIMEOUT_MS) return false;
    if (t - prev.sampledAt < STREAM_SAMPLE_MS) return true;
    const changed = textLength !== prev.length;
    samples.set(node, { ...prev, length: textLength, sampledAt: t });
    return changed;
  };
}

export type StreamSampler = ReturnType<typeof createStreamSampler>;
