/**
 * Building blocks shared by the host adapters: probe, title cleanup, tail-streaming check,
 * and the scroll-up-and-wait "load older" strategy (ADAPTERS.md §4, §5).
 */
import { OLDER_MESSAGES_SCROLL_RATIO, OLDER_MESSAGES_WAIT_MS } from '@shared/constants';
import { createStallDetector, createStreamSampler, type StallDetector, type StreamSampler } from './dom-utils';
import type { AdapterProbeResult, HostAdapter } from './types';

export type Clock = () => number;

export interface AdapterOptions {
  /** Injectable clock for the streaming sampler (tests). */
  now?: Clock;
}

export function samplerFor(opts: AdapterOptions): StreamSampler {
  return opts.now ? createStreamSampler(opts.now) : createStreamSampler();
}

export function stallFor(opts: AdapterOptions): StallDetector {
  return opts.now ? createStallDetector(opts.now) : createStallDetector();
}

/**
 * Memoise `fn` for the current synchronous task. A reconcile asks every node whether it is
 * streaming, and each answer needs the full node list; without this that is O(n²) queries.
 */
export function perTask<T>(fn: () => T): () => T {
  let cached: T;
  let valid = false;
  return () => {
    if (!valid) {
      cached = fn();
      valid = true;
      queueMicrotask(() => {
        valid = false;
      });
    }
    return cached;
  };
}

/** Runs every capability once; used by health.ts and the registry fallback check. */
export function probeAdapter(adapter: Omit<HostAdapter, 'probe'>, loc: Location = location): AdapterProbeResult {
  const nodes = adapter.listMessageNodes();
  return {
    scrollContainer: adapter.getScrollContainer() !== null,
    observerRoot: adapter.getObserverRoot() !== null,
    messageNodes: nodes.length,
    actionBarMounts: nodes.filter((n) => {
      const mp = adapter.getActionBarMount(n);
      return mp !== null && mp.styleHint !== 'floating';
    }).length,
    threadId: adapter.getThreadId(loc) !== null,
    nativeIds: nodes.length > 0 && nodes.every((n) => adapter.getNativeId(n) !== null),
  };
}

/** `document.title` without the host's " - Product" suffix; null when nothing is left. */
export function titleWithout(suffix: RegExp): string | null {
  const title = document.title.replace(suffix, '').trim();
  return title.length > 0 ? title : null;
}

/**
 * Generic streaming fallback: only the last assistant node can be streaming, so only it is
 * sampled. Sampling every node would defer the whole thread by STREAM_SAMPLE_MS on boot.
 */
export function tailIsStreaming(
  sampler: StreamSampler,
  node: HTMLElement,
  nodes: readonly HTMLElement[],
  isAssistant: (n: HTMLElement) => boolean,
  text: (n: HTMLElement) => string,
): boolean {
  const tail = [...nodes].reverse().find(isAssistant);
  if (tail !== node) return false;
  return sampler(node, text(node).length);
}

/** Scroll the container up by most of a viewport; resolves whether more nodes mounted. */
export function scrollUpForOlder(
  container: HTMLElement | null,
  countNodes: () => number,
): Promise<boolean> {
  if (!container || container.scrollTop <= 0) return Promise.resolve(false);
  const before = countNodes();
  container.scrollTop = Math.max(0, container.scrollTop - container.clientHeight * OLDER_MESSAGES_SCROLL_RATIO);
  return new Promise((resolve) => {
    setTimeout(() => resolve(countNodes() > before), OLDER_MESSAGES_WAIT_MS);
  });
}

/** First path segment after `prefix` if it is a plausible id. */
export function pathId(loc: Location, pattern: RegExp): string | null {
  const m = pattern.exec(loc.pathname);
  return m?.[1] ?? null;
}
