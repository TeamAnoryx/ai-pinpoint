/**
 * Content-script RPC client for the worker-owned store (ARCHITECTURE.md I5, CLAUDE.md R4).
 * 5 s timeout, exactly one retry on transport failure. Retrying is safe because every
 * mutation is idempotent by pinId (EDGE_CASES.md §9). Structured errors are never retried.
 */
import { RPC_MAX_RETRIES, RPC_TIMEOUT_MS } from '@shared/constants';
import {
  RPC_PROTOCOL,
  type ErrorCode,
  type RpcPayload,
  type RpcRequest,
  type RpcResponse,
  type RpcResult,
  type WorkerRpcType,
} from '@shared/rpc';

export class RpcCallError extends Error {
  constructor(
    readonly code: ErrorCode | 'TIMEOUT' | 'DISCONNECTED',
    message: string,
  ) {
    super(message);
    this.name = 'RpcCallError';
  }
}

export type Transport = (message: unknown) => Promise<unknown>;

export interface StoreProxyOptions {
  transport?: Transport;
  timeoutMs?: number;
  retries?: number;
  newRequestId?: () => string;
  /** False once the extension was updated or reloaded under this content script (EDGE_CASES §19). */
  contextValid?: () => boolean;
}

function defaultContextValid(): boolean {
  // Only a present runtime that lost its id means "orphaned"; no runtime at all is a test host.
  if (typeof chrome === 'undefined' || !chrome.runtime) return true;
  return Boolean(chrome.runtime.id);
}

function defaultTransport(message: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

let counter = 0;
function defaultRequestId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `cs-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RpcCallError('TIMEOUT', 'The extension did not respond.')),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function isResponse(v: unknown): v is RpcResponse {
  return typeof v === 'object' && v !== null && 'ok' in v && 'requestId' in v;
}

export function createStoreProxy(options: StoreProxyOptions = {}) {
  const transport = options.transport ?? defaultTransport;
  const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
  const retries = options.retries ?? RPC_MAX_RETRIES;
  const newRequestId = options.newRequestId ?? defaultRequestId;
  const contextValid = options.contextValid ?? defaultContextValid;

  async function attempt<K extends WorkerRpcType>(request: RpcRequest<K>): Promise<RpcResult<K>> {
    let raw: unknown;
    try {
      raw = await withTimeout(transport(request), timeoutMs);
    } catch (err) {
      if (err instanceof RpcCallError) throw err;
      // An update orphans this script: no retry can succeed, the tab must be reloaded.
      if (!contextValid()) throw new RpcCallError('VERSION_MISMATCH', 'Extension updated — reload this tab.');
      // "Extension context invalidated" / "Receiving end does not exist" and friends.
      throw new RpcCallError('DISCONNECTED', err instanceof Error ? err.message : String(err));
    }
    if (!isResponse(raw)) throw new RpcCallError('DISCONNECTED', 'No response from the extension.');
    if (!raw.ok) throw new RpcCallError(raw.error.code, raw.error.message);
    return raw.data as RpcResult<K>;
  }

  async function call<K extends WorkerRpcType>(
    type: K,
    payload: RpcPayload<K>,
  ): Promise<RpcResult<K>> {
    // One requestId for all attempts: the worker treats retries of the same call identically.
    const request = {
      protocol: RPC_PROTOCOL,
      type,
      requestId: newRequestId(),
      payload,
    } as RpcRequest<K>;
    let lastError: RpcCallError | undefined;
    for (let i = 0; i <= retries; i++) {
      try {
        return await attempt(request);
      } catch (err) {
        if (!(err instanceof RpcCallError)) throw err;
        const transient = err.code === 'TIMEOUT' || err.code === 'DISCONNECTED';
        if (!transient) throw err;
        lastError = err;
      }
    }
    throw lastError ?? new RpcCallError('DISCONNECTED', 'No response from the extension.');
  }

  return { call };
}

export type StoreProxy = ReturnType<typeof createStoreProxy>;
