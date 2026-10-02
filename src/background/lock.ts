/**
 * In-memory promise-chain locks (DATA_MODEL.md §6). A worker restart starts with no locks,
 * which is correct: an interrupted mutation either completed its single set or did not.
 */
export interface Locks {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Acquires several locks in sorted order, so two multi-lock holders cannot deadlock. */
  withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T>;
  /** Number of keys with a pending or running holder. For tests and leak checks. */
  size(): number;
}

export function createLocks(): Locks {
  const tails = new Map<string, Promise<void>>();

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  }

  function withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    const sorted = [...new Set(keys)].sort();
    const acquire = (i: number): Promise<T> => {
      const key = sorted[i];
      return key === undefined ? fn() : withLock(key, () => acquire(i + 1));
    };
    return acquire(0);
  }

  return { withLock, withLocks, size: () => tails.size };
}
