import { StoreError } from '@background/errors';
import { type TransferDeps, exportBundle, importBundle, mergeThread } from '@background/transfer';
import { KEY_PREFIX, SETTINGS_KEY, quarantineKey, threadKey } from '@shared/constants';
import type { ThreadRef } from '@shared/rpc';
import type { ExportBundle, Pin, ThreadRecord } from '@shared/schema';
import { META, REF, meta, newPin, ref } from '../../support/builders';
import { FakeArea, type Harness, makeHarness } from '../../support/fake-area';

function transferDeps(h: Harness, broadcasts: ThreadRef[] = []): TransferDeps {
  return {
    area: h.area,
    locks: h.locks,
    store: h.store,
    now: () => h.clock.value,
    extensionVersion: '1.0.0',
    broadcast: (r) => broadcasts.push(r),
  };
}

async function seedPins(h: Harness): Promise<void> {
  await h.store.addPin(REF, newPin({ label: null }), META);
  const p = await h.store.addPin(REF, newPin(), META);
  await h.store.updatePin(REF, p.pinId, { label: 'Spec message' });
  await h.store.addPin(ref('claude:two'), newPin(), meta('two'));
  await h.store.addPin(ref('gemini:g1', 'gemini'), newPin({ role: 'user' }), meta('g1'));
  await h.store.setSettings({ theme: 'dark' });
}

async function wipe(area: FakeArea): Promise<void> {
  const keys = [...area.data.keys()].filter((k) => k.startsWith(KEY_PREFIX));
  await area.remove(keys);
}

describe('export / import', () => {
  test('export → wipe → import reproduces every pin field-for-field (PRD §9.6)', async () => {
    const h = makeHarness();
    await seedPins(h);
    const deps = transferDeps(h);
    const exported = await exportBundle(deps);
    const json = JSON.stringify(exported, null, 2);
    await wipe(h.area);
    expect(await h.store.listPins(REF)).toEqual([]);

    const report = await importBundle(deps, JSON.parse(json), 'replace', false);
    expect(report).toMatchObject({ committed: true, error: null, threadsAdded: 3 });
    const reexported = await exportBundle(deps);
    expect(reexported.threads).toEqual(exported.threads);
    expect(reexported.settings).toEqual(exported.settings);
    expect(await h.store.listThreads('claude')).toHaveLength(2);
  });

  test('dry run reports the plan and writes nothing; numbers match the real run', async () => {
    const h = makeHarness();
    await seedPins(h);
    const deps = transferDeps(h);
    const bundle = await exportBundle(deps);
    const extra = await (async () => {
      const other = makeHarness();
      await other.store.addPin(ref('claude:new'), newPin(), meta('new'));
      return exportBundle(transferDeps(other));
    })();
    const combined: ExportBundle = { ...bundle, threads: [...bundle.threads, ...extra.threads] };
    const before = h.area.snapshot();
    const dry = await importBundle(deps, combined, 'merge', true);
    expect(h.area.snapshot()).toEqual(before);
    expect(dry).toMatchObject({
      dryRun: true,
      committed: false,
      threadsAdded: 1,
      threadsMerged: 3,
      pinsAdded: 1,
      pinsConflicting: 4,
    });
    const real = await importBundle(deps, combined, 'merge', false);
    expect({ ...real, dryRun: true, committed: false, writtenKeys: 0 }).toEqual(dry);
  });

  test('merge: newer updatedAt wins on pinId collision; unknown pins appended and renormalised', () => {
    const base: Pin = { ...newPin({ pinId: 'a' }), order: 100, updatedAt: 10, repairCount: 0 };
    const existing: ThreadRecord = {
      schema: 1,
      hostId: 'claude',
      threadId: 'claude:x',
      title: 'mine',
      url: META.url,
      pins: [base, { ...newPin({ pinId: 'b' }), order: 200, updatedAt: 10, repairCount: 0 }],
      createdAt: 1,
      updatedAt: 10,
    };
    const incoming: ThreadRecord = {
      ...existing,
      title: 'theirs',
      pins: [
        { ...base, label: 'newer', updatedAt: 20 },
        { ...newPin({ pinId: 'b' }), label: 'older', order: 200, updatedAt: 5, repairCount: 0 },
        { ...newPin({ pinId: 'c' }), order: 50, updatedAt: 1, repairCount: 0 },
      ],
      updatedAt: 30,
    };
    const { rec, added, conflicts } = mergeThread(existing, incoming);
    expect(added).toBe(1);
    expect(conflicts).toBe(2);
    expect(rec.pins.map((p) => [p.pinId, p.label, p.order])).toEqual([
      ['a', 'newer', 100],
      ['b', null, 200],
      ['c', null, 300],
    ]);
    expect(rec.title).toBe('theirs');
  });

  test('replace deletes other threads only for hosts present in the bundle', async () => {
    const h = makeHarness();
    await seedPins(h);
    const deps = transferDeps(h);
    const other = makeHarness();
    await other.store.addPin(ref('claude:only'), newPin(), meta('only'));
    const bundle = await exportBundle(transferDeps(other));
    const report = await importBundle(deps, bundle, 'replace', false);
    expect(report).toMatchObject({ threadsAdded: 1, threadsReplaced: 2, committed: true });
    expect((await h.store.listThreads('claude')).map((t) => t.threadId)).toEqual(['claude:only']);
    expect(await h.store.listThreads('gemini')).toHaveLength(1);
    expect((await h.store.getSettings()).theme).toBe(bundle.settings.theme);
  });

  test('merge keeps current settings', async () => {
    const h = makeHarness();
    await seedPins(h);
    const deps = transferDeps(h);
    const bundle = await exportBundle(deps);
    await importBundle(
      deps,
      { ...bundle, settings: { ...bundle.settings, theme: 'light' } },
      'merge',
      false,
    );
    expect((await h.store.getSettings()).theme).toBe('dark');
  });

  test('rejects foreign or newer-schema files with SCHEMA_INVALID and writes nothing', async () => {
    const h = makeHarness();
    const deps = transferDeps(h);
    const before = h.area.snapshot();
    for (const bad of [{ kind: 'other' }, { kind: 'ai-pinpoint-export', schema: 99 }, null, 'x']) {
      await expect(importBundle(deps, bad, 'merge', false)).rejects.toSatisfy(
        (e: unknown) => e instanceof StoreError && e.code === 'SCHEMA_INVALID',
      );
    }
    expect(h.area.snapshot()).toEqual(before);
  });

  test('an import that would exceed quota writes nothing and says so', async () => {
    const big = makeHarness(new FakeArea(400_000, false));
    for (let i = 0; i < 40; i++) {
      await big.store.addPin(
        ref(`claude:t${i}`),
        newPin({ snippet: 'x'.repeat(400) }),
        meta(`t${i}`),
      );
    }
    const bundle = await exportBundle(transferDeps(big));
    const h = makeHarness(new FakeArea(30_000, false));
    const before = h.area.snapshot();
    const report = await importBundle(transferDeps(h), bundle, 'merge', false);
    expect(report).toMatchObject({ quota: 'exceeded', committed: false, writtenKeys: 0 });
    expect(report.error?.code).toBe('QUOTA_EXCEEDED');
    expect(h.area.snapshot()).toEqual(before);
  });

  test('a storage failure mid-import returns a partial report', async () => {
    const source = makeHarness();
    for (let i = 0; i < 45; i++)
      await source.store.addPin(ref(`claude:t${i}`), newPin(), meta(`t${i}`));
    const bundle = await exportBundle(transferDeps(source));
    const h = makeHarness(new FakeArea(undefined, false));
    const original = h.area.set.bind(h.area);
    let calls = 0;
    h.area.set = async (items) => {
      calls++;
      if (calls === 2) throw new Error('QUOTA_BYTES quota exceeded');
      return original(items);
    };
    const report = await importBundle(transferDeps(h), bundle, 'merge', false);
    expect(report).toMatchObject({ writtenKeys: 20, error: { code: 'QUOTA_EXCEEDED' } });
  });

  test('importing over an unreadable record quarantines it first (never overwrites raw data)', async () => {
    const h = makeHarness();
    const key = threadKey(REF.hostId, REF.threadId);
    h.area.seed({ [key]: { corrupt: true } });
    const source = makeHarness();
    await source.store.addPin(REF, newPin(), META);
    await importBundle(transferDeps(h), await exportBundle(transferDeps(source)), 'merge', false);
    expect(h.area.peek(quarantineKey(key))).toEqual({ corrupt: true });
    expect(await h.store.listPins(REF)).toHaveLength(1);
  });

  test('read-only storage refuses a committed import but allows a dry run', async () => {
    const h = makeHarness();
    const deps = transferDeps(h);
    const source = makeHarness();
    await source.store.addPin(REF, newPin(), META);
    const bundle = await exportBundle(transferDeps(source));
    h.readOnly.value = true;
    await expect(importBundle(deps, bundle, 'merge', true)).resolves.toMatchObject({
      dryRun: true,
    });
    await expect(importBundle(deps, bundle, 'merge', false)).rejects.toSatisfy(
      (e: unknown) => e instanceof StoreError && e.code === 'READ_ONLY',
    );
    expect(h.area.peek(SETTINGS_KEY)).toBeUndefined();
  });

  test('broadcasts store:changed for every imported thread', async () => {
    const h = makeHarness();
    const broadcasts: ThreadRef[] = [];
    const source = makeHarness();
    await seedPins(source);
    await importBundle(
      transferDeps(h, broadcasts),
      await exportBundle(transferDeps(source)),
      'merge',
      false,
    );
    expect(broadcasts).toHaveLength(3);
  });
});
