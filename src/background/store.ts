/**
 * The single writer for all user data (ARCHITECTURE.md I5, DATA_MODEL.md §6).
 *
 * Invariants:
 * - Every thread mutation runs under that thread's lock and ends in exactly one storage.set
 *   (or remove, when the thread empties). No read-modify-write spans an unlocked await.
 * - Everything read from storage is validated; invalid values are quarantined, never deleted.
 * - The host index is a cache; the thread records are the source of truth.
 */
import {
  INDEX_KEY_PREFIX,
  KEY_PREFIX,
  MAX_LABEL_CHARS,
  MAX_PINS_PER_THREAD,
  MAX_THREADS_PER_HOST,
  QUARANTINE_KEY_PREFIX,
  QUOTA_BLOCK_RATIO,
  QUOTA_WARN_RATIO,
  SETTINGS_KEY,
  THREAD_KEY_PREFIX,
  indexKey,
  quarantineKey,
  threadKey,
} from '@shared/constants';
import type { NewPin, PinPatch, StorageStats, ThreadMeta, ThreadRef } from '@shared/rpc';
import {
  DEFAULT_SETTINGS,
  HOST_IDS,
  SCHEMA_VERSION,
  type HostId,
  type HostIndex,
  type Pin,
  type Settings,
  type ThreadRecord,
  type ThreadSummary,
  validateHostIndex,
  validateSettings,
  validateThreadRecord,
} from '@shared/schema';
import { StoreError, isQuotaError } from './errors';
import { type KvArea, entryBytes } from './kv';
import type { Locks } from './lock';
import { assignOrders, byDisplayOrder, nextOrder, resolveSequence } from './ordering';

export interface StoreDeps {
  area: KvArea;
  locks: Locks;
  now: () => number;
  /** Fan-out of `store:changed`; failures must not fail the mutation. */
  broadcast: (ref: ThreadRef) => void;
  /** True when storage holds a newer schema (DATA_MODEL.md §9). */
  isReadOnly: () => boolean;
}

export type QuotaLevel = StorageStats['level'];

export function quotaLevel(bytesUsed: number, quota: number): QuotaLevel {
  const ratio = bytesUsed / quota;
  if (ratio > QUOTA_BLOCK_RATIO) return 'block';
  if (ratio > QUOTA_WARN_RATIO) return 'warn';
  return 'ok';
}

export function emptyThread(hostId: HostId, threadId: string, now: number): ThreadRecord {
  return {
    schema: SCHEMA_VERSION,
    hostId,
    threadId,
    title: null,
    url: '',
    pins: [],
    createdAt: now,
    updatedAt: now,
  };
}

function summarise(rec: ThreadRecord): ThreadSummary {
  return {
    threadId: rec.threadId,
    title: rec.title,
    pinCount: rec.pins.length,
    updatedAt: rec.updatedAt,
    url: rec.url,
  };
}

function sortSummaries(threads: ThreadSummary[]): ThreadSummary[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

function cleanLabel(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null;
  const trimmed = label.trim().slice(0, MAX_LABEL_CHARS);
  return trimmed.length > 0 ? trimmed : null;
}

export type Store = ReturnType<typeof createStore>;

export function createStore(deps: StoreDeps) {
  const { area, locks, now } = deps;

  function assertWritable(): void {
    if (deps.isReadOnly()) {
      throw new StoreError(
        'READ_ONLY',
        'Storage was written by a newer version; changes are disabled.',
      );
    }
  }

  async function write(items: Record<string, unknown>): Promise<void> {
    try {
      await area.set(items);
    } catch (err) {
      if (isQuotaError(err))
        throw new StoreError('QUOTA_EXCEEDED', 'Storage is full. Export and prune old threads.');
      throw err;
    }
  }

  /** Move an invalid value aside under the quarantine prefix (EDGE_CASES.md §18). */
  async function quarantine(key: string, raw: unknown): Promise<void> {
    if (deps.isReadOnly()) return;
    await area.set({ [quarantineKey(key)]: raw });
    await area.remove(key);
  }

  async function readThread(hostId: HostId, threadId: string): Promise<ThreadRecord | null> {
    const key = threadKey(hostId, threadId);
    const raw = (await area.get(key))[key];
    if (raw === undefined) return null;
    const result = validateThreadRecord(raw);
    if (result.ok && result.value.hostId === hostId && result.value.threadId === threadId) {
      return result.value;
    }
    await quarantine(key, raw);
    return null;
  }

  async function storageStatsBytes(): Promise<number> {
    return area.getBytesInUse(null);
  }

  /** Refuse a write that would push usage past the block ratio (FR-12, DATA_MODEL.md §8). */
  async function assertQuotaFor(deltaBytes: number): Promise<void> {
    if (deltaBytes <= 0) return;
    const used = await storageStatsBytes();
    if (quotaLevel(used + deltaBytes, area.quota) === 'block') {
      throw new StoreError(
        'QUOTA_EXCEEDED',
        'Storage is nearly full. Export and prune old threads.',
      );
    }
  }

  // --- host index (cache) ---------------------------------------------------------------

  async function readIndex(hostId: HostId): Promise<HostIndex | null> {
    const key = indexKey(hostId);
    const raw = (await area.get(key))[key];
    if (raw === undefined) return null;
    const result = validateHostIndex(raw);
    return result.ok && result.value.hostId === hostId ? result.value : null;
  }

  async function updateIndex(
    hostId: HostId,
    change: (threads: ThreadSummary[]) => ThreadSummary[],
  ): Promise<void> {
    await locks.withLock(indexKey(hostId), async () => {
      const current = await readIndex(hostId);
      if (!current) {
        await rebuildIndexUnlocked(hostId);
        return;
      }
      const next: HostIndex = { ...current, threads: sortSummaries(change(current.threads)) };
      await area.set({ [indexKey(hostId)]: next });
    });
  }

  async function rebuildIndexUnlocked(hostId: HostId): Promise<HostIndex> {
    const prefix = `${THREAD_KEY_PREFIX}${hostId}:`;
    const all = await area.get(null);
    const threads: ThreadSummary[] = [];
    for (const [key, raw] of Object.entries(all)) {
      if (!key.startsWith(prefix)) continue;
      const result = validateThreadRecord(raw);
      if (result.ok && result.value.pins.length > 0) threads.push(summarise(result.value));
    }
    const index: HostIndex = { schema: SCHEMA_VERSION, hostId, threads: sortSummaries(threads) };
    if (!deps.isReadOnly()) {
      // The index is a cache: failing to persist it must never fail the caller.
      await area.set({ [indexKey(hostId)]: index }).catch(() => undefined);
    }
    return index;
  }

  function rebuildIndex(hostId: HostId): Promise<HostIndex> {
    return locks.withLock(indexKey(hostId), () => rebuildIndexUnlocked(hostId));
  }

  /** Index failures never fail the mutation: the record is already correct (§6). */
  async function syncIndex(
    rec: ThreadRecord | null,
    hostId: HostId,
    threadId: string,
  ): Promise<void> {
    try {
      await updateIndex(hostId, (threads) => {
        const others = threads.filter((t) => t.threadId !== threadId);
        return rec && rec.pins.length > 0 ? [...others, summarise(rec)] : others;
      });
    } catch {
      // Lazy repair: threads:list rebuilds a missing or invalid index.
    }
  }

  // --- the mutation primitive -------------------------------------------------------------

  /**
   * DATA_MODEL.md §6. `fn` returns the next record, or null to signal "no change" (an
   * idempotent retry), in which case nothing is written and nothing is broadcast.
   */
  async function mutateThread(
    hostId: HostId,
    threadId: string,
    fn: (rec: ThreadRecord, existed: boolean) => ThreadRecord | null,
    opts: { growth?: boolean } = {},
  ): Promise<ThreadRecord> {
    assertWritable();
    const key = threadKey(hostId, threadId);
    const rec = await locks.withLock(key, async () => {
      const current = await readThread(hostId, threadId);
      const base = current ?? emptyThread(hostId, threadId, now());
      const changed = fn(base, current !== null);
      if (changed === null) return { rec: base, wrote: false };
      const next: ThreadRecord = { ...changed, updatedAt: now() };
      if (next.pins.length === 0) {
        if (current) await area.remove(key);
        return { rec: next, wrote: current !== null };
      }
      const validated = validateThreadRecord(next);
      if (!validated.ok) {
        throw new StoreError(
          'SCHEMA_INVALID',
          `${validated.error.path}: ${validated.error.message}`,
        );
      }
      if (opts.growth) {
        const before = current ? entryBytes(key, current) : 0;
        await assertQuotaFor(entryBytes(key, next) - before);
        if (!current) await assertThreadCapacity(hostId);
      }
      await write({ [key]: next });
      return { rec: next, wrote: true };
    });
    if (rec.wrote) {
      await syncIndex(rec.rec, hostId, threadId);
      deps.broadcast({ hostId, threadId });
    }
    return rec.rec;
  }

  async function assertThreadCapacity(hostId: HostId): Promise<void> {
    const index = (await readIndex(hostId)) ?? (await rebuildIndex(hostId));
    if (index.threads.length >= MAX_THREADS_PER_HOST) {
      throw new StoreError(
        'QUOTA_EXCEEDED',
        `This site already has ${MAX_THREADS_PER_HOST} threads with pins. Prune old threads first.`,
      );
    }
  }

  function findPin(rec: ThreadRecord, pinId: string): Pin {
    const pin = rec.pins.find((p) => p.pinId === pinId);
    if (!pin) throw new StoreError('NOT_FOUND', 'Pin not found.');
    return pin;
  }

  // --- public operations ------------------------------------------------------------------

  async function listPins(ref: ThreadRef): Promise<Pin[]> {
    const rec = await readThread(ref.hostId, ref.threadId);
    return rec ? [...rec.pins].sort(byDisplayOrder) : [];
  }

  async function addPin(ref: ThreadRef, pin: NewPin, thread: ThreadMeta): Promise<Pin> {
    let stored: Pin | undefined;
    await mutateThread(
      ref.hostId,
      ref.threadId,
      (rec) => {
        const existing = rec.pins.find((p) => p.pinId === pin.pinId);
        if (existing) {
          stored = existing;
          return null;
        }
        if (rec.pins.length >= MAX_PINS_PER_THREAD) {
          throw new StoreError(
            'QUOTA_EXCEEDED',
            `A thread can hold at most ${MAX_PINS_PER_THREAD} pins.`,
          );
        }
        const t = now();
        stored = { ...pin, order: nextOrder(rec.pins), updatedAt: t, repairCount: 0 };
        return {
          ...rec,
          title: thread.title ?? rec.title,
          url: thread.url,
          pins: [...rec.pins, stored],
        };
      },
      { growth: true },
    );
    if (!stored) throw new StoreError('INTERNAL', 'Pin was not stored.');
    return stored;
  }

  function updatePinWith(ref: ThreadRef, pinId: string, change: (pin: Pin) => Pin): Promise<Pin> {
    let updated: Pin | undefined;
    return mutateThread(ref.hostId, ref.threadId, (rec, existed) => {
      if (!existed) throw new StoreError('NOT_FOUND', 'Thread not found.');
      const pin = change(findPin(rec, pinId));
      updated = { ...pin, updatedAt: now() };
      return { ...rec, pins: rec.pins.map((p) => (p.pinId === pinId ? (updated as Pin) : p)) };
    }).then(() => {
      if (!updated) throw new StoreError('INTERNAL', 'Pin was not updated.');
      return updated;
    });
  }

  function updatePin(ref: ThreadRef, pinId: string, patch: PinPatch): Promise<Pin> {
    return updatePinWith(ref, pinId, (pin) =>
      'label' in patch ? { ...pin, label: cleanLabel(patch.label) } : pin,
    );
  }

  function repairHash(ref: ThreadRef, pinId: string, newHash: string): Promise<Pin> {
    return updatePinWith(ref, pinId, (pin) => ({
      ...pin,
      targetHash: newHash,
      repairCount: pin.repairCount + 1,
    }));
  }

  async function removePin(ref: ThreadRef, pinId: string): Promise<{ removed: true }> {
    await mutateThread(ref.hostId, ref.threadId, (rec, existed) => {
      if (!existed || !rec.pins.some((p) => p.pinId === pinId)) return null;
      return { ...rec, pins: rec.pins.filter((p) => p.pinId !== pinId) };
    });
    return { removed: true };
  }

  async function reorderPins(ref: ThreadRef, orderedIds: readonly string[]): Promise<Pin[]> {
    const rec = await mutateThread(ref.hostId, ref.threadId, (current, existed) => {
      if (!existed) throw new StoreError('NOT_FOUND', 'Thread not found.');
      const { pins } = assignOrders(resolveSequence(current.pins, orderedIds));
      return { ...current, pins };
    });
    return [...rec.pins].sort(byDisplayOrder);
  }

  async function listThreads(hostId: HostId): Promise<ThreadSummary[]> {
    const index = await locks.withLock(indexKey(hostId), async () => {
      return (await readIndex(hostId)) ?? (await rebuildIndexUnlocked(hostId));
    });
    return sortSummaries(index.threads);
  }

  // --- settings ---------------------------------------------------------------------------

  async function getSettings(): Promise<Settings> {
    const raw = (await area.get(SETTINGS_KEY))[SETTINGS_KEY];
    if (raw === undefined) return { ...DEFAULT_SETTINGS };
    const result = validateSettings(raw);
    if (result.ok) return result.value;
    await quarantine(SETTINGS_KEY, raw);
    return { ...DEFAULT_SETTINGS };
  }

  async function setSettings(patch: Partial<Settings>): Promise<Settings> {
    assertWritable();
    return locks.withLock(SETTINGS_KEY, async () => {
      const current = await getSettings();
      const merged = {
        ...current,
        ...patch,
        hosts: { ...current.hosts, ...(patch.hosts ?? {}) },
        schema: SCHEMA_VERSION,
      };
      const result = validateSettings(merged);
      if (!result.ok) {
        throw new StoreError('SCHEMA_INVALID', `${result.error.path}: ${result.error.message}`);
      }
      await write({ [SETTINGS_KEY]: result.value });
      return result.value;
    });
  }

  // --- stats ------------------------------------------------------------------------------

  async function storageStats(): Promise<StorageStats> {
    const all = await area.get(null);
    const bytesUsed = await area.getBytesInUse(null);
    const perHost = Object.fromEntries(HOST_IDS.map((h) => [h, 0])) as Record<HostId, number>;
    const quarantined: string[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(QUARANTINE_KEY_PREFIX)) {
        quarantined.push(key.slice(QUARANTINE_KEY_PREFIX.length));
        continue;
      }
      const host = HOST_IDS.find(
        (h) => key.startsWith(`${THREAD_KEY_PREFIX}${h}:`) || key === `${INDEX_KEY_PREFIX}${h}`,
      );
      if (host) perHost[host] += entryBytes(key, value);
    }
    return {
      bytesUsed,
      quota: area.quota,
      perHost,
      quarantined: quarantined.sort(),
      level: quotaLevel(bytesUsed, area.quota),
      readOnly: deps.isReadOnly(),
    };
  }

  /** Options → Prune: delete whole threads, then rebuild the host index (D-017). */
  async function removeThreads(hostId: HostId, threadIds: readonly string[]): Promise<{ removed: number; bytesReclaimed: number }> {
    assertWritable();
    let removed = 0;
    let bytesReclaimed = 0;
    for (const threadId of new Set(threadIds)) {
      const key = threadKey(hostId, threadId);
      const gone = await locks.withLock(key, async () => {
        const raw = (await area.get(key))[key];
        if (raw === undefined) return false;
        bytesReclaimed += entryBytes(key, raw);
        await area.remove(key);
        return true;
      });
      if (gone) {
        removed++;
        deps.broadcast({ hostId, threadId });
      }
    }
    if (removed > 0) await rebuildIndex(hostId);
    return { removed, bytesReclaimed };
  }

  /**
   * Options → Wipe all (typed confirmation, D-017). Allowed in read-only mode: it is the
   * explicit, user-confirmed way out of data a newer build wrote.
   */
  async function wipeAll(): Promise<{ removedKeys: number; threads: { hostId: HostId; threadId: string }[] }> {
    const all = await area.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
    const threads: { hostId: HostId; threadId: string }[] = [];
    for (const key of keys) {
      if (!key.startsWith(THREAD_KEY_PREFIX)) continue;
      const rest = key.slice(THREAD_KEY_PREFIX.length);
      const host = HOST_IDS.find((h) => rest.startsWith(`${h}:`));
      if (host) threads.push({ hostId: host, threadId: rest.slice(host.length + 1) });
    }
    if (keys.length > 0) await area.remove(keys);
    for (const ref of threads) deps.broadcast(ref);
    return { removedKeys: keys.length, threads };
  }

  return {
    removeThreads,
    wipeAll,
    readThread,
    mutateThread,
    listPins,
    addPin,
    updatePin,
    repairHash,
    removePin,
    reorderPins,
    listThreads,
    rebuildIndex,
    getSettings,
    setSettings,
    storageStats,
    assertQuotaFor,
    assertWritable,
  };
}
