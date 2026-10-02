/**
 * Schema migrations (DATA_MODEL.md §9): forward-only, idempotent, backup first, read-only on
 * downgrade. Runs on onInstalled and defensively before the first RPC after a worker wake.
 */
import { META_KEY, quarantineKey } from '@shared/constants';
import { SCHEMA_VERSION, type StoreMeta, validateStoreMeta } from '@shared/schema';
import type { KvArea } from './kv';

/** Upgrade storage from version `n - 1` to `n`. Must be idempotent and never delete data. */
export type Migration = (area: KvArea) => Promise<void>;

/** 1: initial schema — nothing to migrate. Add `2: async (area) => {...}` for schema 2. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export interface MigrationState {
  readOnly: boolean;
  reason: 'newer-schema' | 'migration-failed' | null;
  /** In-memory export taken before the last migration, offered for download (§9). */
  backup: unknown;
}

export interface MigratorDeps {
  area: KvArea;
  now: () => number;
  migrations?: Readonly<Record<number, Migration>>;
  /** Schema the code expects. Injected only by tests exercising multi-step chains. */
  targetVersion?: number;
  buildBackup: () => Promise<unknown>;
}

export interface Migrator {
  /** Runs at most once per worker lifetime; concurrent callers share the same run. */
  ensure(): Promise<MigrationState>;
  state(): MigrationState;
}

export function createMigrator(deps: MigratorDeps): Migrator {
  const migrations = deps.migrations ?? MIGRATIONS;
  const target = deps.targetVersion ?? SCHEMA_VERSION;
  let current: MigrationState = { readOnly: false, reason: null, backup: null };
  let running: Promise<MigrationState> | null = null;

  async function writeMeta(meta: StoreMeta): Promise<void> {
    await deps.area.set({ [META_KEY]: meta });
  }

  async function run(): Promise<MigrationState> {
    const raw = (await deps.area.get(META_KEY))[META_KEY];
    const fresh: StoreMeta = { schema: target, installedAt: deps.now(), lastMigratedFrom: null };
    if (raw === undefined) {
      await writeMeta(fresh);
      return current;
    }
    const parsed = validateStoreMeta(raw);
    if (!parsed.ok) {
      // Keep the unreadable meta for diagnosis; assume the current schema going forward.
      await deps.area.set({ [quarantineKey(META_KEY)]: raw });
      await writeMeta(fresh);
      return current;
    }
    const meta = parsed.value;
    if (meta.schema === target) return current;
    if (meta.schema > target) {
      current = { ...current, readOnly: true, reason: 'newer-schema' };
      return current;
    }
    const backup = await deps.buildBackup();
    current = { ...current, backup };
    try {
      for (let v = meta.schema + 1; v <= target; v++) {
        const step = migrations[v];
        if (!step) throw new Error(`missing migration to schema ${v}`);
        await step(deps.area);
      }
    } catch {
      current = { ...current, readOnly: true, reason: 'migration-failed' };
      return current;
    }
    await writeMeta({ ...meta, schema: target, lastMigratedFrom: meta.schema });
    return current;
  }

  return {
    ensure() {
      running ??= run();
      return running;
    },
    state: () => current,
  };
}
