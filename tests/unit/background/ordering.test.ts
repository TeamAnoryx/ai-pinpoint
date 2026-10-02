import { assignOrders, nextOrder, resolveSequence } from '@background/ordering';
import type { Pin } from '@shared/schema';
import { META, REF, newPin } from '../../support/builders';
import { FakeArea, makeHarness } from '../../support/fake-area';

function pins(orders: number[]): Pin[] {
  return orders.map((order, i) => ({
    ...newPin({ pinId: `p${i}` }),
    order,
    updatedAt: 1,
    repairCount: 0,
  }));
}

function ids(list: Pin[]): string[] {
  return list.map((p) => p.pinId);
}

describe('ordering', () => {
  test('nextOrder appends one step after the max', () => {
    expect(nextOrder([])).toBe(100);
    expect(nextOrder(pins([100, 450, 200]))).toBe(550);
  });

  test('moving one pin renumbers only that pin into the gap', () => {
    const list = pins([100, 200, 300, 400]);
    const seq = resolveSequence(list, ['p0', 'p3', 'p1', 'p2']);
    const { pins: out, renormalised } = assignOrders(seq);
    expect(renormalised).toBe(false);
    expect(ids(out)).toEqual(['p0', 'p3', 'p1', 'p2']);
    const orders = out.map((p) => p.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    const changed = out.filter((p) => list.find((q) => q.pinId === p.pinId)?.order !== p.order);
    expect(ids(changed)).toEqual(['p3']);
  });

  test('moving to the end and to the front both work', () => {
    const list = pins([100, 200, 300]);
    expect(ids(assignOrders(resolveSequence(list, ['p1', 'p2', 'p0'])).pins)).toEqual([
      'p1',
      'p2',
      'p0',
    ]);
    expect(ids(assignOrders(resolveSequence(list, ['p2', 'p0', 'p1'])).pins)).toEqual([
      'p2',
      'p0',
      'p1',
    ]);
  });

  test('repeated mid-insertions renormalise exactly once when the gap closes', () => {
    let list = pins([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    let renormalisations = 0;
    // Keep dragging the last pin to between the first two pins.
    for (let i = 0; i < 8; i++) {
      const order = [...list].sort((a, b) => a.order - b.order);
      const last = order[order.length - 1] as Pin;
      const rest = order.slice(0, -1);
      const seq = [rest[0] as Pin, last, ...rest.slice(1)];
      const result = assignOrders(resolveSequence(list, ids(seq)));
      if (result.renormalised) renormalisations++;
      list = result.pins;
      expect(ids([...list].sort((a, b) => a.order - b.order))).toEqual(ids(seq));
    }
    // Gap 100 → 50 → 25 → 12 → 6 → 3 → 1 → closed on the 7th insertion.
    expect(renormalisations).toBe(1);
  });

  test('resolveSequence ignores unknown ids and keeps unlisted pins after listed ones', () => {
    const list = pins([100, 200, 300]);
    expect(ids(resolveSequence(list, ['p2', 'ghost', 'p2']))).toEqual(['p2', 'p0', 'p1']);
  });

  test('each reorder is exactly one storage write, including the renormalising one', async () => {
    const area = new FakeArea(undefined, false);
    const { store } = makeHarness(area);
    const created = [];
    for (let i = 0; i < 9; i++) created.push(await store.addPin(REF, newPin(), META));
    let reorderSets = 0;
    for (let i = 0; i < 8; i++) {
      const current = await store.listPins(REF);
      const last = current[current.length - 1] as Pin;
      const seq = [current[0] as Pin, last, ...current.slice(1, -1)];
      const before = area.sets;
      await store.reorderPins(REF, ids(seq));
      // thread write + index write
      reorderSets += area.sets - before;
      expect(ids(await store.listPins(REF))).toEqual(ids(seq));
    }
    expect(reorderSets).toBe(8 * 2);
  });
});
