/**
 * The slice of chrome.storage.local the store uses. An interface so tests can supply an
 * in-memory area with the same semantics (quota errors, byte accounting).
 */
import { STORAGE_QUOTA_BYTES_FALLBACK } from '@shared/constants';

export interface KvArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getBytesInUse(keys: string | string[] | null): Promise<number>;
  readonly quota: number;
}

export function chromeLocalArea(): KvArea {
  const area = chrome.storage.local;
  return {
    get: (keys) => area.get(keys),
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
    getBytesInUse: (keys) => area.getBytesInUse(keys),
    quota: typeof area.QUOTA_BYTES === 'number' ? area.QUOTA_BYTES : STORAGE_QUOTA_BYTES_FALLBACK,
  };
}

/** Approximation of how Chrome accounts one entry: key length + JSON length. */
export function entryBytes(key: string, value: unknown): number {
  return key.length + JSON.stringify(value).length;
}
