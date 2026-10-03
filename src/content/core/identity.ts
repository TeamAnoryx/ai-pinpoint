/**
 * Message identity (DATA_MODEL.md §4) — the critical algorithm. Computes stable hashes for
 * message nodes, keeps a live hash → node index, and resolves stored pins back to nodes.
 *
 * Hash forms:
 *   n:<fnv(nativeId)>             host-native id (high confidence)
 *   c:<fnv(content)>:<ordinal>    content hash; the ordinal segment is a tiebreaker only
 * Every node is indexed under both forms (when it has a native id), so pins created from
 * a content hash — e.g. imported from another session — still match on id-first hosts.
 */
import {
  HASH_HEAD_CHARS,
  HASH_TAIL_CHARS,
  MAX_SIMILARITY_SCAN,
  ORDINAL_BUCKET,
  SIMILARITY_EARLY_EXIT,
  SIMILARITY_THRESHOLD,
} from '@shared/constants';
import { fnv1a32, normaliseForHash, trigramSimilarity } from '@shared/hash';
import type { Pin, Role } from '@shared/schema';
import type { NewPin } from '@shared/rpc';
import type { HostAdapter } from '@content/adapters/types';

export interface MessageMeta {
  /** Primary hash: native when available, else content. */
  hash: string;
  contentHash: string;
  /** Content hash without the ordinal segment. */
  base: string;
  nativeId: string | null;
  role: Role;
  text: string;
  /** normaliseForHash(text), cached for similarity. */
  norm: string;
  ordinal: number;
}

export type ResolveVia = 'exact' | 'native' | 'base' | 'base-nearest' | 'similarity';

export interface Resolution {
  node: HTMLElement;
  meta: MessageMeta;
  via: ResolveVia;
  /** True when several live nodes share the pin's content (EDGE_CASES.md §7). */
  duplicate: boolean;
}

/** The fields of a stored pin that identity needs. */
export type PinTarget = Pick<Pin, 'targetHash' | 'nativeId' | 'role' | 'snippet' | 'ordinal'>;

export function contentBase(role: Role, text: string): string {
  const norm = normaliseForHash(text);
  const head = norm.slice(0, HASH_HEAD_CHARS);
  const tail = norm.slice(-HASH_TAIL_CHARS);
  return `c:${fnv1a32(`${role}|${norm.length}|${head}|${tail}`).toString(36)}`;
}

export function contentHash(role: Role, text: string, ordinal: number): string {
  return `${contentBase(role, text)}:${(ordinal % ORDINAL_BUCKET).toString(36)}`;
}

export function nativeHash(nativeId: string): string {
  return `n:${fnv1a32(nativeId).toString(36)}`;
}

/** `c:<x>:<ord>` → `c:<x>`; native hashes have no ordinal and are returned unchanged. */
export function baseOf(hash: string): string {
  if (!hash.startsWith('c:')) return hash;
  const cut = hash.lastIndexOf(':');
  return cut > 1 ? hash.slice(0, cut) : hash;
}

interface Cached {
  text: string;
  base: string;
  norm: string;
  nativeId: string | null;
  role: Role;
}

export function createIdentity(adapter: HostAdapter) {
  /** Per-node text/hash cache; WeakMap so unmounted nodes are collectable. */
  const cache = new WeakMap<HTMLElement, Cached>();
  let byHash = new Map<string, HTMLElement>();
  let byBase = new Map<string, HTMLElement[]>();
  let byNative = new Map<string, HTMLElement>();
  let metas = new Map<HTMLElement, MessageMeta>();
  let ordered: HTMLElement[] = [];

  function cached(node: HTMLElement): Cached {
    const hit = cache.get(node);
    if (hit) return hit;
    const text = adapter.getText(node);
    const role = adapter.getRole(node);
    const entry: Cached = {
      text,
      role,
      base: contentBase(role, text),
      norm: normaliseForHash(text),
      nativeId: adapter.getNativeId(node),
    };
    cache.set(node, entry);
    return entry;
  }

  function compute(node: HTMLElement, ordinal: number): MessageMeta {
    const c = cached(node);
    const content = `${c.base}:${(ordinal % ORDINAL_BUCKET).toString(36)}`;
    return {
      hash: c.nativeId ? nativeHash(c.nativeId) : content,
      contentHash: content,
      base: c.base,
      nativeId: c.nativeId,
      role: c.role,
      text: c.text,
      norm: c.norm,
      ordinal,
    };
  }

  /**
   * Rebuild the live index from the nodes of one reconcile tick (document order). Nodes in
   * `pending` (still streaming) keep their ordinal slot but are not hashed or cached: a hash
   * computed mid-stream is wrong (EDGE_CASES.md §1).
   */
  function rebuildIndex(nodes: readonly HTMLElement[], pending: ReadonlySet<HTMLElement> = new Set()): void {
    byHash = new Map();
    byBase = new Map();
    byNative = new Map();
    metas = new Map();
    ordered = [...nodes];
    nodes.forEach((node, ordinal) => {
      if (pending.has(node)) {
        cache.delete(node);
        return;
      }
      const meta = compute(node, ordinal);
      metas.set(node, meta);
      byHash.set(meta.hash, node);
      byHash.set(meta.contentHash, node);
      if (meta.nativeId) byNative.set(meta.nativeId, node);
      const group = byBase.get(meta.base) ?? [];
      group.push(node);
      byBase.set(meta.base, group);
    });
  }

  function hit(node: HTMLElement, via: ResolveVia): Resolution {
    const meta = metas.get(node)!;
    return { node, meta, via, duplicate: (byBase.get(meta.base)?.length ?? 0) > 1 };
  }

  function nearest(candidates: readonly HTMLElement[], ordinal: number): HTMLElement {
    let best = candidates[0]!;
    let bestDist = Infinity;
    for (const node of candidates) {
      const dist = Math.abs((metas.get(node)?.ordinal ?? Infinity) - ordinal);
      if (dist < bestDist) {
        best = node;
        bestDist = dist;
      }
    }
    return best;
  }

  function bySimilarity(pin: PinTarget): HTMLElement | null {
    const target = normaliseForHash(pin.snippet);
    if (target.length === 0) return null;
    let best: HTMLElement | null = null;
    let bestScore = 0;
    // Scan outward from the pin's ordinal so the closest plausible nodes are tried first.
    const order = ordered
      .map((node, i) => ({ node, d: Math.abs(i - pin.ordinal) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_SIMILARITY_SCAN);
    for (const { node } of order) {
      const meta = metas.get(node);
      if (!meta) continue;
      if (pin.role !== 'unknown' && meta.role !== 'unknown' && meta.role !== pin.role) continue;
      const score = trigramSimilarity(target, meta.norm.slice(0, target.length), SIMILARITY_THRESHOLD);
      if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
        best = node;
        bestScore = score;
        if (score >= SIMILARITY_EARLY_EXIT) break;
      }
    }
    return best;
  }

  /** Steps 1–5 of DATA_MODEL.md §4 against the live index. Null → caller runs recovery. */
  function resolve(pin: PinTarget): Resolution | null {
    const exact = byHash.get(pin.targetHash);
    if (exact) return hit(exact, 'exact');
    if (pin.nativeId) {
      const native = byNative.get(pin.nativeId);
      if (native) return hit(native, 'native');
    }
    const group = pin.targetHash.startsWith('c:') ? byBase.get(baseOf(pin.targetHash)) : undefined;
    if (group && group.length === 1) return hit(group[0]!, 'base');
    if (group && group.length > 1) return hit(nearest(group, pin.ordinal), 'base-nearest');
    const similar = bySimilarity(pin);
    return similar ? hit(similar, 'similarity') : null;
  }

  /** Fields for a new pin created from `node` (caller adds pinId, label, createdAt). */
  function describe(node: HTMLElement, snippetChars: number): Omit<NewPin, 'pinId' | 'label' | 'createdAt'> | null {
    const meta = metas.get(node);
    if (!meta) return null;
    return {
      targetHash: meta.hash,
      nativeId: meta.nativeId,
      role: meta.role,
      snippet: meta.text.slice(0, snippetChars),
      textLength: meta.text.length,
      ordinal: meta.ordinal,
    };
  }

  return {
    compute,
    rebuildIndex,
    resolve,
    describe,
    meta: (node: HTMLElement): MessageMeta | undefined => metas.get(node),
    /** Hashes a pin could match exactly right now (overlay "in view" state). */
    resolvableHashes: (): Set<string> => new Set(byHash.keys()),
    /** Does the live thread contain more than one message with this pin's content? */
    isDuplicate(pin: PinTarget): boolean {
      const r = resolve(pin);
      return r?.duplicate ?? false;
    },
    /** A fallback resolution means the stored hash is stale and should be repaired. */
    needsRepair: (pin: PinTarget, r: Resolution): boolean => r.via !== 'exact' && r.meta.hash !== pin.targetHash,
    nodeCount: (): number => ordered.length,
    /** Drop a node's cached text so it is re-read (e.g. after a host re-render). */
    invalidate(node: HTMLElement): void {
      cache.delete(node);
    },
    clear(): void {
      byHash = new Map();
      byBase = new Map();
      byNative = new Map();
      metas = new Map();
      ordered = [];
    },
  };
}

export type Identity = ReturnType<typeof createIdentity>;
