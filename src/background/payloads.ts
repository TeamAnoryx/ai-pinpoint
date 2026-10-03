/**
 * Inbound RPC payload validation (ARCHITECTURE.md §8: the worker validates every payload
 * before touching storage). Each parser returns a typed payload or throws SCHEMA_INVALID.
 */
import {
  MAX_ID_CHARS,
  MAX_PINS_PER_THREAD,
  MAX_TITLE_CHARS,
  MAX_URL_CHARS,
} from '@shared/constants';
import type {
  ImportMode,
  NewPin,
  PinPatch,
  RpcPayload,
  ThreadMeta,
  ThreadRef,
  WorkerRpcType,
} from '@shared/rpc';
import { HOST_IDS, type HostId, type Settings, validatePin } from '@shared/schema';
import { StoreError } from './errors';

/** Thread ids with this prefix are memory-only and must never reach storage (DATA_MODEL.md §3). */
export const TRANSIENT_PREFIX = 'transient:';

type Obj = Record<string, unknown>;

function invalid(message: string): never {
  throw new StoreError('SCHEMA_INVALID', message);
}

function obj(v: unknown, what: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) invalid(`${what} must be an object`);
  return v as Obj;
}

function idString(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID_CHARS)
    invalid(`${what} is invalid`);
  return v;
}

function hostId(v: unknown): HostId {
  const match = HOST_IDS.find((h) => h === v);
  if (!match) invalid('hostId is invalid');
  return match;
}

function threadRef(o: Obj): ThreadRef {
  const threadId = idString(o['threadId'], 'threadId');
  if (threadId.startsWith(TRANSIENT_PREFIX)) invalid('transient threads are never persisted');
  return { hostId: hostId(o['hostId']), threadId };
}

function newPin(v: unknown): NewPin {
  const result = validatePin({ ...obj(v, 'pin'), order: 0, updatedAt: 0, repairCount: 0 });
  if (!result.ok) invalid(`pin.${result.error.path}: ${result.error.message}`);
  const p = result.value;
  // Worker-assigned fields (order, updatedAt, repairCount) are dropped, never trusted.
  return {
    pinId: p.pinId,
    targetHash: p.targetHash,
    nativeId: p.nativeId,
    role: p.role,
    snippet: p.snippet,
    textLength: p.textLength,
    ordinal: p.ordinal,
    label: p.label,
    createdAt: p.createdAt,
  };
}

function threadMeta(v: unknown): ThreadMeta {
  const o = obj(v, 'thread');
  const title = o['title'];
  const url = o['url'];
  if (title !== null && typeof title !== 'string') invalid('thread.title must be a string or null');
  if (typeof url !== 'string' || url.length > MAX_URL_CHARS || !url.startsWith('https://')) {
    invalid('thread.url must be an https URL');
  }
  return { title: title === null ? null : title.slice(0, MAX_TITLE_CHARS), url };
}

function pinPatch(v: unknown): PinPatch {
  const o = obj(v, 'patch');
  if (!('label' in o)) return {};
  const label = o['label'];
  if (label !== null && typeof label !== 'string') invalid('patch.label must be a string or null');
  return { label };
}

function nullPayload(): null {
  return null;
}

type Parsers = { [K in WorkerRpcType]: (payload: unknown) => RpcPayload<K> };

export const PARSERS: Parsers = {
  'settings:get': nullPayload,
  'settings:set': (p) => obj(p, 'settings') as Partial<Settings>,
  'pins:list': (p) => threadRef(obj(p, 'payload')),
  'pins:add': (p) => {
    const o = obj(p, 'payload');
    return { ...threadRef(o), pin: newPin(o['pin']), thread: threadMeta(o['thread']) };
  },
  'pins:update': (p) => {
    const o = obj(p, 'payload');
    return { ...threadRef(o), pinId: idString(o['pinId'], 'pinId'), patch: pinPatch(o['patch']) };
  },
  'pins:remove': (p) => {
    const o = obj(p, 'payload');
    return { ...threadRef(o), pinId: idString(o['pinId'], 'pinId') };
  },
  'pins:reorder': (p) => {
    const o = obj(p, 'payload');
    const ids = o['orderedIds'];
    if (!Array.isArray(ids) || ids.length > MAX_PINS_PER_THREAD) invalid('orderedIds is invalid');
    return { ...threadRef(o), orderedIds: ids.map((id) => idString(id, 'orderedIds[]')) };
  },
  'pins:repairHash': (p) => {
    const o = obj(p, 'payload');
    return {
      ...threadRef(o),
      pinId: idString(o['pinId'], 'pinId'),
      newHash: idString(o['newHash'], 'newHash'),
    };
  },
  'threads:list': (p) => ({ hostId: hostId(obj(p, 'payload')['hostId']) }),
  'transfer:export': nullPayload,
  'transfer:import': (p) => {
    const o = obj(p, 'payload');
    const mode = o['mode'];
    if (mode !== 'merge' && mode !== 'replace') invalid('mode must be merge or replace');
    if (typeof o['dryRun'] !== 'boolean') invalid('dryRun must be a boolean');
    return { bundle: o['bundle'], mode: mode satisfies ImportMode, dryRun: o['dryRun'] };
  },
  'storage:stats': nullPayload,
  'ui:openOptions': nullPayload,
};
