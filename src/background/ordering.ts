/**
 * Sparse manual ordering (DATA_MODEL.md §5). Orders are integers spaced by ORDER_STEP; a
 * reorder keeps every pin already in increasing position and renumbers only the moved ones
 * into the gaps. When a gap has no free integer, the whole thread is renormalised.
 */
import { ORDER_STEP } from '@shared/constants';
import type { Pin } from '@shared/schema';

export function byDisplayOrder(a: Pin, b: Pin): number {
  return a.order - b.order || a.createdAt - b.createdAt;
}

export function nextOrder(pins: readonly Pin[]): number {
  return pins.reduce((max, p) => Math.max(max, p.order), 0) + ORDER_STEP;
}

export function renormalise(pins: readonly Pin[]): Pin[] {
  return pins.map((p, i) => ({ ...p, order: (i + 1) * ORDER_STEP }));
}

/** Indices of one longest strictly-increasing subsequence of `values` (patience sort). */
function longestIncreasing(values: readonly number[]): Set<number> {
  const tailIdx: number[] = [];
  const prev: number[] = new Array<number>(values.length).fill(-1);
  values.forEach((v, i) => {
    let lo = 0;
    let hi = tailIdx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[tailIdx[mid] ?? 0] ?? 0) < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tailIdx[lo - 1] ?? -1;
    tailIdx[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tailIdx[tailIdx.length - 1] ?? -1; i >= 0; i = prev[i] ?? -1) keep.add(i);
  return keep;
}

/**
 * The display sequence requested by `orderedIds`: listed pins first (unknown ids ignored),
 * then any pins the caller did not list, in their current order (D-009).
 */
export function resolveSequence(pins: readonly Pin[], orderedIds: readonly string[]): Pin[] {
  const byId = new Map(pins.map((p) => [p.pinId, p]));
  const listed: Pin[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    const pin = byId.get(id);
    if (pin && !seen.has(id)) {
      listed.push(pin);
      seen.add(id);
    }
  }
  const rest = [...pins].sort(byDisplayOrder).filter((p) => !seen.has(p.pinId));
  return [...listed, ...rest];
}

export interface OrderResult {
  pins: Pin[];
  renormalised: boolean;
}

/** Assigns orders so `sequence` displays in that order, touching as few pins as possible. */
export function assignOrders(sequence: readonly Pin[]): OrderResult {
  const keep = longestIncreasing(sequence.map((p) => p.order));
  const out = sequence.map((p) => ({ ...p }));
  let i = 0;
  while (i < out.length) {
    if (keep.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && !keep.has(j)) j++;
    const low = i > 0 ? (out[i - 1]?.order ?? 0) : 0;
    const high = j < out.length ? (out[j]?.order ?? 0) : low + (j - i + 1) * ORDER_STEP;
    const count = j - i;
    const step = Math.floor((high - low) / (count + 1));
    if (step < 1) return { pins: renormalise(sequence), renormalised: true };
    for (let k = 0; k < count; k++) {
      const pin = out[i + k];
      if (pin) pin.order = low + step * (k + 1);
    }
    i = j;
  }
  return { pins: out, renormalised: false };
}
