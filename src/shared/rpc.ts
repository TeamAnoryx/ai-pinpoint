/**
 * RPC contract — single source of truth (ARCHITECTURE.md §8).
 * Request:  { protocol, type, requestId, payload }
 * Response: { requestId, ok: true, data } | { requestId, ok: false, error: { code, message } }
 */
import type { ExportBundle, HostId, Pin, Settings, ThreadSummary } from './schema';

/** Bumped on any breaking change to this file; mismatches reject with VERSION_MISMATCH (D-007). */
export const RPC_PROTOCOL = 1 as const;

export type ErrorCode =
  | 'QUOTA_EXCEEDED'
  | 'SCHEMA_INVALID'
  | 'NOT_FOUND'
  | 'ADAPTER_UNAVAILABLE'
  | 'VERSION_MISMATCH'
  | 'READ_ONLY'
  | 'INTERNAL';

export interface RpcError {
  code: ErrorCode;
  message: string;
}

export interface ThreadRef {
  hostId: HostId;
  threadId: string;
}

/**
 * A pin as created by the content script. `pinId` and `createdAt` are client-generated so
 * a retried `pins:add` is idempotent (the worker dedupes by pinId). The worker assigns
 * `order`, `updatedAt`, and `repairCount`.
 */
export type NewPin = Omit<Pin, 'order' | 'updatedAt' | 'repairCount'>;

/** Thread metadata only the content script can know (the worker knows no hosts — I1). */
export interface ThreadMeta {
  title: string | null;
  /** Reconstructable https URL for FR-7 navigation. */
  url: string;
}

export interface PinPatch {
  label?: string | null;
}

export type ImportMode = 'merge' | 'replace';

export interface ImportReport {
  mode: ImportMode;
  dryRun: boolean;
  threadsAdded: number;
  threadsMerged: number;
  threadsReplaced: number;
  pinsAdded: number;
  pinsConflicting: number;
  bytesDelta: number;
  quota: 'ok' | 'warn' | 'exceeded';
  /** False for a dry run, or when an import aborted part-way (see writtenKeys). */
  committed: boolean;
  writtenKeys: number;
  error: RpcError | null;
}

export interface StorageStats {
  bytesUsed: number;
  quota: number;
  perHost: Record<HostId, number>;
  /** Storage keys whose values failed validation and were moved aside (EDGE_CASES.md §18). */
  quarantined: string[];
  /** Ratio thresholds already crossed, so the UI can warn without recomputing (FR-12). */
  level: 'ok' | 'warn' | 'block';
  /** True when storage was written by a newer schema; all writes are refused (DATA_MODEL §9). */
  readOnly: boolean;
}

export interface Ack {
  ack: true;
}

/** Messages handled by the service worker (content script / popup / options → SW). */
export interface WorkerRpc {
  'settings:get': { payload: null; result: Settings };
  'settings:set': { payload: Partial<Settings>; result: Settings };
  'pins:list': { payload: ThreadRef; result: Pin[] };
  'pins:add': { payload: ThreadRef & { pin: NewPin; thread: ThreadMeta }; result: Pin };
  'pins:update': { payload: ThreadRef & { pinId: string; patch: PinPatch }; result: Pin };
  'pins:remove': { payload: ThreadRef & { pinId: string }; result: { removed: true } };
  'pins:reorder': { payload: ThreadRef & { orderedIds: string[] }; result: Pin[] };
  'pins:repairHash': { payload: ThreadRef & { pinId: string; newHash: string }; result: Pin };
  'threads:list': { payload: { hostId: HostId }; result: ThreadSummary[] };
  'transfer:export': { payload: null; result: ExportBundle };
  'transfer:import': {
    payload: { bundle: unknown; mode: ImportMode; dryRun: boolean };
    result: ImportReport;
  };
  'storage:stats': { payload: null; result: StorageStats };
}

/** Messages handled by content scripts (SW → CS). */
export interface ContentRpc {
  'store:changed': { payload: ThreadRef; result: null };
  'command:pinLast': { payload: null; result: Ack };
  'command:toggleSidebar': { payload: null; result: Ack };
  'command:focusFilter': { payload: null; result: Ack };
  'menu:pinSelection': { payload: { selectionText: string }; result: Ack };
}

export type RpcContract = WorkerRpc & ContentRpc;
export type WorkerRpcType = keyof WorkerRpc;
export type ContentRpcType = keyof ContentRpc;
export type RpcType = keyof RpcContract;

export type RpcPayload<T extends RpcType> = RpcContract[T]['payload'];
export type RpcResult<T extends RpcType> = RpcContract[T]['result'];

export type RpcRequest<T extends RpcType = RpcType> = {
  [K in T]: { protocol: typeof RPC_PROTOCOL; type: K; requestId: string; payload: RpcPayload<K> };
}[T];

export type RpcResponse<T extends RpcType = RpcType> =
  | { requestId: string; ok: true; data: RpcResult<T> }
  | { requestId: string; ok: false; error: RpcError };

export const WORKER_RPC_TYPES: readonly WorkerRpcType[] = [
  'settings:get',
  'settings:set',
  'pins:list',
  'pins:add',
  'pins:update',
  'pins:remove',
  'pins:reorder',
  'pins:repairHash',
  'threads:list',
  'transfer:export',
  'transfer:import',
  'storage:stats',
];

export const CONTENT_RPC_TYPES: readonly ContentRpcType[] = [
  'store:changed',
  'command:pinLast',
  'command:toggleSidebar',
  'command:focusFilter',
  'menu:pinSelection',
];

export interface RpcEnvelope {
  protocol: unknown;
  type: string;
  requestId: string;
  payload: unknown;
}

/**
 * Structural check of the envelope only. Payloads are validated per type by the receiver
 * (the worker against schema.ts) before use.
 */
export function isRpcEnvelope(v: unknown): v is RpcEnvelope {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['type'] === 'string' && typeof o['requestId'] === 'string' && 'payload' in o;
}

export function isWorkerRpcType(type: string): type is WorkerRpcType {
  return (WORKER_RPC_TYPES as readonly string[]).includes(type);
}

export function isContentRpcType(type: string): type is ContentRpcType {
  return (CONTENT_RPC_TYPES as readonly string[]).includes(type);
}

export function rpcOk<T extends RpcType>(requestId: string, data: RpcResult<T>): RpcResponse<T> {
  return { requestId, ok: true, data };
}

export function rpcFail(requestId: string, code: ErrorCode, message: string): RpcResponse<never> {
  return { requestId, ok: false, error: { code, message } };
}
