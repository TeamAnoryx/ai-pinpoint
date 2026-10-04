import { createMigrator } from '@background/migrate';
import { META_KEY, quarantineKey } from '@shared/constants';
import { SCHEMA_VERSION } from '@shared/schema';
import { FakeArea } from '../../support/fake-area';

const NOW = 1_700_000_000_000;

describe('migrations (DATA_MODEL.md §9)', () => {
  test('fresh install writes meta at the current schema', async () => {
    const area = new FakeArea();
    const m = createMigrator({ area, now: () => NOW, buildBackup: async () => 'backup' });
    const state = await m.ensure();
    expect(state.readOnly).toBe(false);
    expect(area.peek(META_KEY)).toEqual({
      schema: SCHEMA_VERSION,
      installedAt: NOW,
      lastMigratedFrom: null,
    });
  });

  test('same schema is a no-op', async () => {
    const area = new FakeArea();
    area.seed({ [META_KEY]: { schema: SCHEMA_VERSION, installedAt: 5, lastMigratedFrom: null } });
    const sets = area.sets;
    await createMigrator({ area, now: () => NOW, buildBackup: async () => null }).ensure();
    expect(area.sets).toBe(sets);
  });

  test('newer schema enters read-only mode and writes nothing', async () => {
    const area = new FakeArea();
    area.seed({
      [META_KEY]: { schema: SCHEMA_VERSION + 1, installedAt: 5, lastMigratedFrom: null },
    });
    const before = area.snapshot();
    const state = await createMigrator({
      area,
      now: () => NOW,
      buildBackup: async () => null,
    }).ensure();
    expect(state).toMatchObject({ readOnly: true, reason: 'newer-schema' });
    expect(area.snapshot()).toEqual(before);
  });

  test('older schema takes a backup, runs each step in order, then bumps meta', async () => {
    const area = new FakeArea();
    area.seed({ [META_KEY]: { schema: 1, installedAt: 5, lastMigratedFrom: null } });
    const steps: number[] = [];
    const m = createMigrator({
      area,
      now: () => NOW,
      buildBackup: async () => ({ snapshot: true }),
      targetVersion: 3,
      migrations: { 2: async () => void steps.push(2), 3: async () => void steps.push(3) },
    });
    const state = await m.ensure();
    expect(steps).toEqual([2, 3]);
    expect(state.backup).toEqual({ snapshot: true });
    expect(area.peek(META_KEY)).toEqual({ schema: 3, installedAt: 5, lastMigratedFrom: 1 });
  });

  test('a missing or failing migration leaves data untouched and goes read-only', async () => {
    const area = new FakeArea();
    area.seed({ [META_KEY]: { schema: 1, installedAt: 5, lastMigratedFrom: null }, data: 1 });
    const state = await createMigrator({
      area,
      now: () => NOW,
      buildBackup: async () => null,
      migrations: {},
      targetVersion: 2,
    }).ensure();
    expect(state).toMatchObject({ readOnly: true, reason: 'migration-failed' });
    expect(area.peek(META_KEY)).toEqual({ schema: 1, installedAt: 5, lastMigratedFrom: null });
    expect(area.peek('data')).toBe(1);
  });

  test('unreadable meta is quarantined and replaced', async () => {
    const area = new FakeArea();
    area.seed({ [META_KEY]: 'garbage' });
    await createMigrator({ area, now: () => NOW, buildBackup: async () => null }).ensure();
    expect(area.peek(quarantineKey(META_KEY))).toBe('garbage');
    expect(area.peek(META_KEY)).toMatchObject({ schema: SCHEMA_VERSION });
  });

  test('concurrent callers share one run (onInstalled racing the first RPC)', async () => {
    const area = new FakeArea();
    let backups = 0;
    area.seed({ [META_KEY]: { schema: 1, installedAt: 5, lastMigratedFrom: null } });
    const m = createMigrator({
      area,
      now: () => NOW,
      buildBackup: async () => ++backups,
      targetVersion: 2,
      migrations: { 2: async () => undefined },
    });
    await Promise.all([m.ensure(), m.ensure(), m.ensure()]);
    expect(backups).toBe(1);
  });
});
