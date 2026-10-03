/**
 * Origin → adapter resolution (ADAPTERS.md §7). A known host whose probe finds nothing gets
 * a fallback wrapper that keeps the real host's id and thread scoping, so a host redesign
 * never orphans stored pins.
 */
import { logger } from '@shared/logger';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { genericAdapter } from './generic';
import type { HostAdapter } from './types';

const log = logger('registry');

export const HOST_ADAPTERS: readonly HostAdapter[] = [geminiAdapter, chatgptAdapter, claudeAdapter];

/** Adapter whose DOM queries come from `fallback` but whose identity scoping stays `primary`'s. */
export interface FallbackAdapter extends HostAdapter {
  readonly fallbackFrom: HostAdapter;
}

export function withFallback(primary: HostAdapter, fallback: HostAdapter): FallbackAdapter {
  const wrapped: FallbackAdapter = {
    ...fallback,
    id: primary.id,
    fallbackFrom: primary,
    matches: (loc) => primary.matches(loc),
    getThreadId: (loc) => primary.getThreadId(loc),
    probe: () => ({ ...fallback.probe(), threadId: primary.getThreadId(location) !== null }),
  };
  if (primary.getThreadTitle) wrapped.getThreadTitle = () => primary.getThreadTitle?.() ?? null;
  return wrapped;
}

export function isFallback(adapter: HostAdapter): adapter is FallbackAdapter {
  return 'fallbackFrom' in adapter;
}

export function findAdapter(loc: Location, adapters: readonly HostAdapter[] = HOST_ADAPTERS): HostAdapter | null {
  return adapters.find((a) => a.matches(loc)) ?? null;
}

export function resolve(loc: Location, adapters: readonly HostAdapter[] = HOST_ADAPTERS): HostAdapter {
  const direct = findAdapter(loc, adapters);
  if (!direct) return genericAdapter; // host permissions are narrow; should not happen
  const probe = direct.probe();
  if (probe.messageNodes === 0 && probe.actionBarMounts === 0) {
    const generic = genericAdapter.probe();
    if (generic.messageNodes > 0) {
      log.warn('adapter probe empty, falling back to generic', direct.id, probe);
      return withFallback(direct, genericAdapter);
    }
  }
  return direct;
}
