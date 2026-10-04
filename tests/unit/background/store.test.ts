import { StoreError } from '@background/errors';
import {
  MAX_PINS_PER_THREAD,
  SETTINGS_KEY,
  indexKey,
  quarantineKey,
  threadKey,
} from '@shared/constants';
import { DEFAULT_SETTINGS, type ThreadRecord } from '@shared/schema';
import { META, REF, meta, newPin, ref } from '../../support/builders';
import { FakeArea, makeHarness } from '../../support/fake-area';

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof StoreError && e.code === code,
  );
}

describe('store: pin lifecycle', () => {
  test('add → update → repairHash → reorder → remove round-trip', async () => {
    const { store, area } = makeHarness();
    const a = await store.addPin(REF, newPin(), META);
    const b = await store.addPin(REF, newPin(), META);
    const c = await store.addPin(REF, newPin(), META);
    expect([a.order, b.order, c.order]).toEqual([100, 200, 300]);

    const labelled = await store.updatePin(REF, b.pinId, { label: '  spec  ' });
    expect(labelled.label).toBe('spec');
    expect((await store.updatePin(REF, b.pinId, { label: '   ' })).label).toBeNull();

    const repaired = await store.repairHash(REF, a.pinId, 'c:new:9');
    expect(repaired).toMatchObject({ targetHash: 'c:new:9', repairCount: 1 });

    const reordered = await store.reorderPins(REF, [c.pinId, a.pinId, b.pinId]);
    expect(reordered.map((p) => p.pinId)).toEqual([c.pinId, a.pinId, b.pinId]);

    await store.removePin(REF, a.pinId);
    const listed = await store.listPins(REF);
    expect(listed.map((p) => p.pinId)).toEqual([c.pinId, b.pinId]);

    const rec = area.peek(threadKey(REF.hostId, REF.threadId)) as ThreadRecord;
    expect(rec.title).toBe(META.title);
    expect(rec.url).toBe(META.url);
  });

  test('pins:add is idempotent by pinId (safe retry)', async () => {
    const { store, area, broadcasts } = makeHarness();
    const pin = newPin();
    const first = await store.addPin(REF, pin, META);
    const sets = area.sets;
    const second = await store.addPin(REF, pin, META);
    expect(second).toEqual(first);
    expect(area.sets).toBe(sets);
    expect(await store.listPins(REF)).toHaveLength(1);
    expect(broadcasts).toHaveLength(1);
  });

  test('removing an unknown pin succeeds without writing (idempotent)', async () => {
    const { store, area } = makeHarness();
    await store.addPin(REF, newPin(), META);
    const sets = area.sets;
    await expect(store.removePin(REF, 'nope')).resolves.toEqual({ removed: true });
    await expect(store.removePin(ref('claude:none'), 'nope')).resolves.toEqual({ removed: true });
    expect(area.sets).toBe(sets);
  });

  test('update / repair of an unknown pin or thread is NOT_FOUND', async () => {
    const { store } = makeHarness();
    await expectCode(store.updatePin(REF, 'x', { label: 'a' }), 'NOT_FOUND');
    await store.addPin(REF, newPin(), META);
    await expectCode(store.updatePin(REF, 'x', { label: 'a' }), 'NOT_FOUND');
    await expectCode(store.repairHash(REF, 'x', 'c:1'), 'NOT_FOUND');
  });

  test('removing the last pin deletes the thread key and its index entry', async () => {
    const { store, area } = makeHarness();
    const pin = await store.addPin(REF, newPin(), META);
    expect(await store.listThreads('claude')).toHaveLength(1);
    await store.removePin(REF, pin.pinId);
    expect(area.peek(threadKey(REF.hostId, REF.threadId))).toBeUndefined();
    expect(await store.listThreads('claude')).toEqual([]);
  });

  test('every mutation broadcasts store:changed for its thread', async () => {
    const { store, broadcasts } = makeHarness();
    const pin = await store.addPin(REF, newPin(), META);
    await store.updatePin(REF, pin.pinId, { label: 'x' });
    await store.removePin(REF, pin.pinId);
    expect(broadcasts).toEqual([REF, REF, REF]);
  });

  test('refuses a pin beyond MAX_PINS_PER_THREAD', async () => {
    const { store, area } = makeHarness(new FakeArea(undefined, false));
    const pins = Array.from({ length: MAX_PINS_PER_THREAD }, (_, i) => ({
      ...newPin(),
      order: (i + 1) * 100,
      updatedAt: 1,
      repairCount: 0,
    }));
    area.seed({
      [threadKey(REF.hostId, REF.threadId)]: {
        schema: 1,
        hostId: REF.hostId,
        threadId: REF.threadId,
        title: null,
        url: META.url,
        pins,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    await expectCode(store.addPin(REF, newPin(), META), 'QUOTA_EXCEEDED');
  });
});

describe('store: concurrency', () => {
  test('50 interleaved pins:add on one thread produce 50 pins, no lost updates', async () => {
    const { store, locks } = makeHarness();
    const pins = Array.from({ length: 50 }, () => newPin());
    await Promise.all(pins.map((p) => store.addPin(REF, p, META)));
    const listed = await store.listPins(REF);
    expect(listed).toHaveLength(50);
    expect(new Set(listed.map((p) => p.pinId))).toEqual(new Set(pins.map((p) => p.pinId)));
    expect(new Set(listed.map((p) => p.order)).size).toBe(50);
    const [summary] = await store.listThreads('claude');
    expect(summary?.pinCount).toBe(50);
    expect(locks.size()).toBe(0);
  });

  test('concurrent writes to 20 threads keep the shared host index complete', async () => {
    const { store } = makeHarness();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.addPin(ref(`claude:t${i}`), newPin(), meta(`t${i}`)),
      ),
    );
    const threads = await store.listThreads('claude');
    expect(threads).toHaveLength(20);
  });

  test('interleaved adds and removes converge to the expected set', async () => {
    const { store } = makeHarness();
    const keep = Array.from({ length: 10 }, () => newPin());
    const drop = Array.from({ length: 10 }, () => newPin());
    await Promise.all(drop.map((p) => store.addPin(REF, p, META)));
    await Promise.all([
      ...keep.map((p) => store.addPin(REF, p, META)),
      ...drop.map((p) => store.removePin(REF, p.pinId)),
    ]);
    const ids = (await store.listPins(REF)).map((p) => p.pinId).sort();
    expect(ids).toEqual(keep.map((p) => p.pinId).sort());
  });
});

describe('store: host index', () => {
  test('rebuildIndex matches a prefix scan of thread records', async () => {
    const { store, area } = makeHarness();
    await store.addPin(ref('claude:a'), newPin(), meta('a'));
    await store.addPin(ref('claude:b'), newPin(), meta('b'));
    await store.addPin(ref('claude:b'), newPin(), meta('b'));
    await store.addPin(ref('gemini:x', 'gemini'), newPin(), meta('x'));
    const before = await store.listThreads('claude');
    await area.remove(indexKey('claude'));
    const rebuilt = await store.rebuildIndex('claude');
    expect(rebuilt.threads).toEqual(before);
    expect(rebuilt.threads.map((t) => [t.threadId, t.pinCount]).sort()).toEqual([
      ['claude:a', 1],
      ['claude:b', 2],
    ]);
  });

  test('a corrupt index is rebuilt on read, never trusted', async () => {
    const { store, area } = makeHarness();
    await store.addPin(REF, newPin(), META);
    area.seed({ [indexKey('claude')]: { garbage: true } });
    const threads = await store.listThreads('claude');
    expect(threads.map((t) => t.threadId)).toEqual([REF.threadId]);
  });

  test('an index write failure does not fail the pin write', async () => {
    const { store, area } = makeHarness(new FakeArea(undefined, false));
    await store.addPin(REF, newPin(), META);
    // Fail the index write of the next mutation (thread write succeeds first).
    const original = area.set.bind(area);
    let calls = 0;
    area.set = async (items) => {
      calls++;
      if (calls === 2) throw new Error('disk hiccup');
      return original(items);
    };
    await store.addPin(REF, newPin(), META);
    area.set = original;
    expect(await store.listPins(REF)).toHaveLength(2);
    await area.remove(indexKey('claude'));
    expect((await store.listThreads('claude'))[0]?.pinCount).toBe(2);
  });
});

describe('store: quota', () => {
  test('at the block ratio, a new pin returns QUOTA_EXCEEDED and storage is byte-identical', async () => {
    const area = new FakeArea(200_000, false);
    const { store } = makeHarness(area);
    await store.addPin(REF, newPin(), META);
    area.fillTo(0.96);
    const before = area.snapshot();
    await expectCode(store.addPin(REF, newPin(), META), 'QUOTA_EXCEEDED');
    expect(area.snapshot()).toEqual(before);
  });

  test('an over-quota write rejected by storage itself maps to QUOTA_EXCEEDED', async () => {
    const area = new FakeArea(200_000, false);
    const { store } = makeHarness(area);
    await store.addPin(ref('claude:other'), newPin(), meta('other')); // index now exists
    area.failNextSet = new Error('QUOTA_BYTES quota exceeded');
    await expectCode(store.addPin(REF, newPin(), META), 'QUOTA_EXCEEDED');
    expect(await store.listPins(REF)).toEqual([]);
  });

  test('removals still work at the block ratio (users can free space)', async () => {
    const area = new FakeArea(200_000, false);
    const { store } = makeHarness(area);
    const pin = await store.addPin(REF, newPin(), META);
    area.fillTo(0.97);
    await expect(store.removePin(REF, pin.pinId)).resolves.toEqual({ removed: true });
  });

  test('storageStats reports level and per-host bytes', async () => {
    const area = new FakeArea(100_000, false);
    const { store } = makeHarness(area);
    await store.addPin(REF, newPin(), META);
    let stats = await store.storageStats();
    expect(stats.level).toBe('ok');
    expect(stats.perHost.claude).toBeGreaterThan(0);
    expect(stats.perHost.gemini).toBe(0);
    area.fillTo(0.85);
    stats = await store.storageStats();
    expect(stats.level).toBe('warn');
    area.fillTo(0.97);
    expect((await store.storageStats()).level).toBe('block');
  });
});

describe('store: corrupted data (EDGE_CASES.md §18)', () => {
  test('an invalid thread record is quarantined, not deleted, and reads as empty', async () => {
    const { store, area } = makeHarness();
    const key = threadKey(REF.hostId, REF.threadId);
    const raw = { schema: 1, hostId: 'claude', threadId: REF.threadId, pins: 'broken' };
    area.seed({ [key]: raw });
    expect(await store.listPins(REF)).toEqual([]);
    expect(area.peek(quarantineKey(key))).toEqual(raw);
    expect(area.peek(key)).toBeUndefined();
    expect((await store.storageStats()).quarantined).toEqual([key]);
  });

  test('a record stored under the wrong key is quarantined', async () => {
    const { store, area } = makeHarness();
    await store.addPin(ref('claude:other'), newPin(), meta('other'));
    const otherRec = area.peek(threadKey('claude', 'claude:other'));
    area.seed({ [threadKey(REF.hostId, REF.threadId)]: otherRec });
    expect(await store.listPins(REF)).toEqual([]);
    expect(area.peek(quarantineKey(threadKey(REF.hostId, REF.threadId)))).toEqual(otherRec);
  });

  test('pinning into a quarantined thread starts a fresh record; quarantine is kept', async () => {
    const { store, area } = makeHarness();
    const key = threadKey(REF.hostId, REF.threadId);
    area.seed({ [key]: 'nonsense' });
    await store.addPin(REF, newPin(), META);
    expect(await store.listPins(REF)).toHaveLength(1);
    expect(area.peek(quarantineKey(key))).toBe('nonsense');
  });

  test('invalid settings are quarantined and defaults served', async () => {
    const { store, area } = makeHarness();
    area.seed({ [SETTINGS_KEY]: { schema: 1, theme: 42 } });
    expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(area.peek(quarantineKey(SETTINGS_KEY))).toEqual({ schema: 1, theme: 42 });
  });
});

describe('store: read-only mode', () => {
  test('refuses every write with READ_ONLY and leaves storage unchanged', async () => {
    const h = makeHarness();
    const pin = await h.store.addPin(REF, newPin(), META);
    h.readOnly.value = true;
    const before = h.area.snapshot();
    await expectCode(h.store.addPin(REF, newPin(), META), 'READ_ONLY');
    await expectCode(h.store.removePin(REF, pin.pinId), 'READ_ONLY');
    await expectCode(h.store.setSettings({ theme: 'dark' }), 'READ_ONLY');
    expect(h.area.snapshot()).toEqual(before);
    expect(await h.store.listPins(REF)).toHaveLength(1);
    expect((await h.store.storageStats()).readOnly).toBe(true);
  });
});

describe('store: settings', () => {
  test('defaults when absent; partial set merges and validates', async () => {
    const { store } = makeHarness();
    expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS);
    const next = await store.setSettings({
      theme: 'dark',
      hosts: { ...DEFAULT_SETTINGS.hosts, gemini: { enabled: false } },
    });
    expect(next.theme).toBe('dark');
    expect(next.hosts.gemini.enabled).toBe(false);
    expect(next.hosts.claude.enabled).toBe(true);
    expect(await store.getSettings()).toEqual(next);
  });

  test('clamps out-of-range numbers and rejects bad types', async () => {
    const { store } = makeHarness();
    expect((await store.setSettings({ sidebarWidth: 5000 })).sidebarWidth).toBe(520);
    await expectCode(
      store.setSettings({ theme: 'neon' } as unknown as Parameters<typeof store.setSettings>[0]),
      'SCHEMA_INVALID',
    );
  });
});
