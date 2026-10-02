/**
 * Export / import (DATA_MODEL.md §10, FR-10). File handling happens in the options page;
 * this module only builds bundles and applies them. No network.
 */
import {
  IMPORT_BATCH_SIZE,
  ORDER_STEP,
  SETTINGS_KEY,
  THREAD_KEY_PREFIX,
  quarantineKey,
  threadKey,
} from '@shared/constants';
import type { ImportMode, ImportReport, ThreadRef } from '@shared/rpc';
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type ExportBundle,
  type HostId,
  type Pin,
  type Settings,
  type ThreadRecord,
  validateExportBundle,
  validateSettings,
  validateThreadRecord,
} from '@shared/schema';
import { StoreError, isQuotaError } from './errors';
import { type KvArea, entryBytes } from './kv';
import type { Locks } from './lock';
import { byDisplayOrder } from './ordering';
import { type Store, quotaLevel } from './store';

export interface TransferDeps {
  area: KvArea;
  locks: Locks;
  store: Store;
  now: () => number;
  extensionVersion: string;
  broadcast: (ref: ThreadRef) => void;
}

function isThreadKey(key: string): boolean {
  return key.startsWith(THREAD_KEY_PREFIX);
}

/** Valid thread records currently in storage, keyed by storage key. */
function validThreads(all: Record<string, unknown>): Map<string, ThreadRecord> {
  const out = new Map<string, ThreadRecord>();
  for (const [key, raw] of Object.entries(all)) {
    if (!isThreadKey(key)) continue;
    const result = validateThreadRecord(raw);
    if (result.ok && key === threadKey(result.value.hostId, result.value.threadId)) {
      out.set(key, result.value);
    }
  }
  return out;
}

export async function buildExport(
  area: KvArea,
  extensionVersion: string,
  now: number,
): Promise<ExportBundle> {
  const all = await area.get(null);
  const settings = validateSettings(all[SETTINGS_KEY]);
  const threads = [...validThreads(all).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, rec]) => rec);
  return {
    kind: 'ai-pinpoint-export',
    schema: SCHEMA_VERSION,
    exportedAt: now,
    extensionVersion,
    settings: settings.ok ? settings.value : { ...DEFAULT_SETTINGS },
    threads,
  };
}

/** Merge rule (§10): union by pinId, newer updatedAt wins, new pins appended + renormalised. */
export function mergeThread(
  existing: ThreadRecord,
  incoming: ThreadRecord,
): { rec: ThreadRecord; added: number; conflicts: number } {
  const byId = new Map(existing.pins.map((p) => [p.pinId, p]));
  let conflicts = 0;
  const appended: Pin[] = [];
  for (const pin of [...incoming.pins].sort(byDisplayOrder)) {
    const mine = byId.get(pin.pinId);
    if (!mine) {
      appended.push(pin);
      continue;
    }
    conflicts++;
    if (pin.updatedAt > mine.updatedAt) byId.set(pin.pinId, pin);
  }
  let pins = [...byId.values()].sort(byDisplayOrder);
  if (appended.length > 0) {
    pins = [...pins, ...appended].map((p, i) => ({ ...p, order: (i + 1) * ORDER_STEP }));
  }
  const newer = incoming.updatedAt > existing.updatedAt ? incoming : existing;
  return {
    rec: {
      ...existing,
      title: newer.title ?? existing.title,
      url: newer.url,
      pins,
      updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
    },
    added: appended.length,
    conflicts,
  };
}

interface Plan {
  writes: Map<string, ThreadRecord>;
  removals: string[];
  settings: Settings | null;
  report: ImportReport;
}

function plan(
  bundle: ExportBundle,
  existing: Map<string, ThreadRecord>,
  mode: ImportMode,
  dryRun: boolean,
  bytesUsed: number,
  quota: number,
): Plan {
  const writes = new Map<string, ThreadRecord>();
  const removals: string[] = [];
  const report: ImportReport = {
    mode,
    dryRun,
    threadsAdded: 0,
    threadsMerged: 0,
    threadsReplaced: 0,
    pinsAdded: 0,
    pinsConflicting: 0,
    bytesDelta: 0,
    quota: 'ok',
    committed: false,
    writtenKeys: 0,
    error: null,
  };
  const incomingKeys = new Set<string>();

  for (const rec of bundle.threads) {
    const key = threadKey(rec.hostId, rec.threadId);
    incomingKeys.add(key);
    const mine = existing.get(key);
    if (mode === 'merge' && mine) {
      const merged = mergeThread(mine, rec);
      writes.set(key, merged.rec);
      report.threadsMerged++;
      report.pinsAdded += merged.added;
      report.pinsConflicting += merged.conflicts;
    } else {
      writes.set(key, rec);
      if (mine) report.threadsReplaced++;
      else report.threadsAdded++;
      report.pinsAdded += rec.pins.length;
    }
  }

  if (mode === 'replace') {
    const hosts = new Set<HostId>(bundle.threads.map((t) => t.hostId));
    for (const [key, rec] of existing) {
      if (hosts.has(rec.hostId) && !incomingKeys.has(key)) {
        removals.push(key);
        report.threadsReplaced++;
      }
    }
  }

  let delta = 0;
  for (const [key, rec] of writes) {
    const before = existing.get(key);
    delta += entryBytes(key, rec) - (before ? entryBytes(key, before) : 0);
  }
  for (const key of removals) {
    const before = existing.get(key);
    if (before) delta -= entryBytes(key, before);
  }
  report.bytesDelta = delta;
  const level = quotaLevel(bytesUsed + Math.max(0, delta), quota);
  report.quota = level === 'block' ? 'exceeded' : level;

  return { writes, removals, settings: mode === 'replace' ? bundle.settings : null, report };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function importBundle(
  deps: TransferDeps,
  raw: unknown,
  mode: ImportMode,
  dryRun: boolean,
): Promise<ImportReport> {
  const parsed = validateExportBundle(raw);
  if (!parsed.ok) {
    const where = parsed.error.path ? `${parsed.error.path}: ` : '';
    throw new StoreError('SCHEMA_INVALID', `Import rejected — ${where}${parsed.error.message}`);
  }
  if (!dryRun) deps.store.assertWritable();
  const bundle = parsed.value;
  const all = await deps.area.get(null);
  const bytesUsed = await deps.area.getBytesInUse(null);
  const { writes, removals, settings, report } = plan(
    bundle,
    validThreads(all),
    mode,
    dryRun,
    bytesUsed,
    deps.area.quota,
  );

  if (dryRun) return report;
  if (report.quota === 'exceeded') {
    return {
      ...report,
      error: {
        code: 'QUOTA_EXCEEDED',
        message: 'Not enough storage for this import. Nothing was written.',
      },
    };
  }

  const incomingByKey = new Map(bundle.threads.map((t) => [threadKey(t.hostId, t.threadId), t]));
  const touched = new Map<string, ThreadRef>();
  let written = 0;
  try {
    for (const batch of chunk([...writes.keys()], IMPORT_BATCH_SIZE)) {
      await deps.locks.withLocks(batch, async () => {
        // Re-read under the locks: a tab may have pinned since the plan was made.
        const raw = await deps.area.get(batch);
        const live = validThreads(raw);
        const items: Record<string, unknown> = {};
        for (const key of batch) {
          // Never overwrite an unreadable record: move it aside first (EDGE_CASES.md §18).
          if (raw[key] !== undefined && !live.has(key)) items[quarantineKey(key)] = raw[key];
          const incoming = incomingByKey.get(key);
          if (!incoming) continue;
          const mine = live.get(key);
          items[key] = mode === 'merge' && mine ? mergeThread(mine, incoming).rec : incoming;
          touched.set(key, { hostId: incoming.hostId, threadId: incoming.threadId });
        }
        await deps.area.set(items);
        written += batch.length;
      });
    }
    for (const batch of chunk(removals, IMPORT_BATCH_SIZE)) {
      await deps.locks.withLocks(batch, () => deps.area.remove(batch));
      written += batch.length;
    }
    if (settings) await deps.store.setSettings(settings);
  } catch (err) {
    const code =
      err instanceof StoreError ? err.code : isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'INTERNAL';
    return {
      ...report,
      writtenKeys: written,
      error: {
        code,
        message: `Import stopped after ${written} of ${writes.size + removals.length} keys.`,
      },
    };
  } finally {
    const hosts = new Set<HostId>([...touched.values()].map((t) => t.hostId));
    for (const key of removals) {
      const host = all[key] ? validateThreadRecord(all[key]) : null;
      if (host?.ok) hosts.add(host.value.hostId);
    }
    for (const host of hosts) {
      await deps.store.rebuildIndex(host).catch(() => undefined); // index is a cache
    }
    for (const ref of touched.values()) deps.broadcast(ref);
  }
  return { ...report, committed: true, writtenKeys: written };
}

export function exportBundle(deps: TransferDeps): Promise<ExportBundle> {
  return buildExport(deps.area, deps.extensionVersion, deps.now());
}
