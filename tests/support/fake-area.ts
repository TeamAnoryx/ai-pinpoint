/**
 * In-memory stand-in for chrome.storage.local: deep-copies values (as Chrome serialises them),
 * accounts bytes as key + JSON length, rejects over-quota writes atomically, and yields a
 * random macrotask on every call so interleavings resemble a real async backend.
 */
import type { KvArea } from '@background/kv';
import { entryBytes } from '@background/kv';
import { createLocks } from '@background/lock';
import { createStore } from '@background/store';
import type { ThreadRef } from '@shared/rpc';

export class FakeArea implements KvArea {
  readonly data = new Map<string, string>();
  sets = 0;
  removes = 0;
  /** When set, the next set() rejects with this error and changes nothing. */
  failNextSet: Error | null = null;

  constructor(
    readonly quota = 10_485_760,
    private readonly jitter = true,
  ) {}

  private async tick(): Promise<void> {
    await new Promise((resolve) =>
      setTimeout(resolve, this.jitter ? Math.floor(Math.random() * 3) : 0),
    );
  }

  private bytes(entries: Iterable<[string, string]>): number {
    let total = 0;
    for (const [k, v] of entries) total += k.length + v.length;
    return total;
  }

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    await this.tick();
    const wanted = keys === null ? [...this.data.keys()] : typeof keys === 'string' ? [keys] : keys;
    const out: Record<string, unknown> = {};
    for (const k of wanted) {
      const v = this.data.get(k);
      if (v !== undefined) out[k] = JSON.parse(v);
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await this.tick();
    if (this.failNextSet) {
      const err = this.failNextSet;
      this.failNextSet = null;
      throw err;
    }
    const next = new Map(this.data);
    for (const [k, v] of Object.entries(items)) next.set(k, JSON.stringify(v));
    if (this.bytes(next) > this.quota) throw new Error('QUOTA_BYTES quota exceeded');
    for (const [k, v] of next) this.data.set(k, v);
    this.sets++;
  }

  async remove(keys: string | string[]): Promise<void> {
    await this.tick();
    for (const k of typeof keys === 'string' ? [keys] : keys) this.data.delete(k);
    this.removes++;
  }

  async getBytesInUse(keys: string | string[] | null): Promise<number> {
    await this.tick();
    if (keys === null) return this.bytes(this.data);
    const wanted = new Set(typeof keys === 'string' ? [keys] : keys);
    return this.bytes([...this.data].filter(([k]) => wanted.has(k)));
  }

  /** Raw value without the async tick, for assertions. */
  peek(key: string): unknown {
    const v = this.data.get(key);
    return v === undefined ? undefined : JSON.parse(v);
  }

  /** Writes directly, bypassing quota and jitter, to set up a scenario. */
  seed(items: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(items)) this.data.set(k, JSON.stringify(v));
  }

  snapshot(): Map<string, string> {
    return new Map(this.data);
  }

  /** Fills storage with a filler key until usage reaches `ratio` of quota. */
  fillTo(ratio: number): void {
    const key = 'filler';
    const current = this.bytes([...this.data].filter(([k]) => k !== key));
    const wanted = Math.floor(this.quota * ratio) - current - entryBytes(key, '');
    this.seed({ [key]: 'x'.repeat(Math.max(0, wanted)) });
  }
}

export interface Harness {
  area: FakeArea;
  locks: ReturnType<typeof createLocks>;
  store: ReturnType<typeof createStore>;
  broadcasts: ThreadRef[];
  readOnly: { value: boolean };
  clock: { value: number };
}

export function makeHarness(area = new FakeArea()): Harness {
  const locks = createLocks();
  const broadcasts: ThreadRef[] = [];
  const readOnly = { value: false };
  const clock = { value: 1_700_000_000_000 };
  const store = createStore({
    area,
    locks,
    now: () => ++clock.value,
    broadcast: (ref) => broadcasts.push(ref),
    isReadOnly: () => readOnly.value,
  });
  return { area, locks, store, broadcasts, readOnly, clock };
}
