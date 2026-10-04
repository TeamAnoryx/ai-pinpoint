/**
 * Tiered selector sets (ADAPTERS.md §1). Every adapter selector is declared here so the
 * tier that resolved each key is recorded; health.ts reports tier-4-only keys as drift.
 *
 * Tier 1: ARIA / semantic elements. Tier 2: stable data attributes.
 * Tier 3: structural predicates (functions). Tier 4: class-name *patterns* only.
 */
import { logger } from '@shared/logger';
import { deepQueryAll } from './dom-utils';

export type Tier = 1 | 2 | 3 | 4;

export type Finder = (root: ParentNode) => Element[];

export interface TierEntry {
  tier: Tier;
  /** A CSS selector, or a structural predicate for tier 3. */
  find: string | Finder;
}

export const t1 = (css: string): TierEntry => ({ tier: 1, find: css });
export const t2 = (css: string): TierEntry => ({ tier: 2, find: css });
export const t3 = (fn: Finder): TierEntry => ({ tier: 3, find: fn });
export const t4 = (css: string): TierEntry => ({ tier: 4, find: css });

export interface SelectorSet<K extends string> {
  /** First element of the first tier that matches. */
  one(key: K, root?: ParentNode): HTMLElement | null;
  /** All elements of the first tier that matches anything. */
  all(key: K, root?: ParentNode): HTMLElement[];
  /** Tier that last resolved `key`, or null if it has not resolved / last missed. */
  tierOf(key: K): Tier | null;
  /** Snapshot of the last-resolved tier per key. */
  report(): Record<K, Tier | null>;
}

function run(entry: TierEntry, root: ParentNode): HTMLElement[] {
  const found = typeof entry.find === 'string' ? deepQueryAll(root, entry.find) : entry.find(root);
  return found.filter((el): el is HTMLElement => el instanceof HTMLElement);
}

export function createSelectorSet<K extends string>(
  hostId: string,
  spec: Record<K, { tiers: readonly TierEntry[] }>,
): SelectorSet<K> {
  const log = logger(`adapter:${hostId}`);
  const resolved = new Map<K, Tier | null>();

  function all(key: K, root: ParentNode = document): HTMLElement[] {
    for (const entry of spec[key].tiers) {
      let found: HTMLElement[];
      try {
        found = run(entry, root);
      } catch {
        // An invalid selector in one tier must not take the adapter down.
        continue;
      }
      if (found.length > 0) {
        if (resolved.get(key) !== entry.tier) log.debug(`${key} resolved at tier ${entry.tier}`);
        resolved.set(key, entry.tier);
        return found;
      }
    }
    if (resolved.get(key) !== null) log.debug(`${key} missed every tier`);
    resolved.set(key, null);
    return [];
  }

  return {
    all,
    one: (key, root) => all(key, root)[0] ?? null,
    tierOf: (key) => resolved.get(key) ?? null,
    report: () =>
      Object.fromEntries(
        (Object.keys(spec) as K[]).map((k) => [k, resolved.get(k) ?? null]),
      ) as Record<K, Tier | null>,
  };
}
