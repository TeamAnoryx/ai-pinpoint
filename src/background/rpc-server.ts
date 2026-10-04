/**
 * Typed RPC router for messages addressed to the worker (ARCHITECTURE.md §8). Validates the
 * envelope, protocol, and payload; runs pending migrations first; never returns a raw string.
 */
import {
  RPC_PROTOCOL,
  type RpcResponse,
  type RpcResult,
  type WorkerRpcType,
  isRpcEnvelope,
  isWorkerRpcType,
  rpcFail,
  rpcOk,
} from '@shared/rpc';
import { StoreError } from './errors';
import type { Migrator } from './migrate';
import { PARSERS } from './payloads';
import type { Store } from './store';
import type { Settings } from '@shared/schema';
import { type TransferDeps, exportBundle, importBundle } from './transfer';

export interface RpcServerDeps {
  store: Store;
  migrator: Migrator;
  transfer: TransferDeps;
  /** Opens the options page (chrome.runtime.openOptionsPage in the worker). */
  openOptions?: () => Promise<void>;
  /** Called after every successful settings write, to fan out `settings:changed`. */
  onSettingsChanged?: (settings: Settings) => void;
}

type Handlers = { [K in WorkerRpcType]: (payload: unknown) => Promise<RpcResult<K>> };

export function createRpcServer(deps: RpcServerDeps) {
  const { store } = deps;

  const handlers: Handlers = {
    'settings:get': () => store.getSettings(),
    'settings:set': async (p) => {
      const settings = await store.setSettings(PARSERS['settings:set'](p));
      deps.onSettingsChanged?.(settings);
      return settings;
    },
    'pins:list': (p) => store.listPins(PARSERS['pins:list'](p)),
    'pins:add': (p) => {
      const { pin, thread, ...ref } = PARSERS['pins:add'](p);
      return store.addPin(ref, pin, thread);
    },
    'pins:update': (p) => {
      const { pinId, patch, ...ref } = PARSERS['pins:update'](p);
      return store.updatePin(ref, pinId, patch);
    },
    'pins:remove': (p) => {
      const { pinId, ...ref } = PARSERS['pins:remove'](p);
      return store.removePin(ref, pinId);
    },
    'pins:reorder': (p) => {
      const { orderedIds, ...ref } = PARSERS['pins:reorder'](p);
      return store.reorderPins(ref, orderedIds);
    },
    'pins:repairHash': (p) => {
      const { pinId, newHash, ...ref } = PARSERS['pins:repairHash'](p);
      return store.repairHash(ref, pinId, newHash);
    },
    'threads:list': (p) => store.listThreads(PARSERS['threads:list'](p).hostId),
    'transfer:export': () => exportBundle(deps.transfer),
    'transfer:import': (p) => {
      const { bundle, mode, dryRun } = PARSERS['transfer:import'](p);
      return importBundle(deps.transfer, bundle, mode, dryRun);
    },
    'storage:stats': () => store.storageStats(),
    'ui:openOptions': async () => {
      await deps.openOptions?.();
      return { ack: true };
    },
    'threads:remove': (p) => {
      const { hostId, threadIds } = PARSERS['threads:remove'](p);
      return store.removeThreads(hostId, threadIds);
    },
    'storage:wipe': async (p) => {
      PARSERS['storage:wipe'](p);
      const { removedKeys } = await store.wipeAll();
      deps.migrator.reset();
      deps.onSettingsChanged?.(await store.getSettings());
      return { removedKeys };
    },
  };

  async function dispatch<K extends WorkerRpcType>(
    type: K,
    requestId: string,
    payload: unknown,
  ): Promise<RpcResponse<K>> {
    const handler = handlers[type] as (p: unknown) => Promise<RpcResult<K>>;
    return rpcOk<K>(requestId, await handler(payload));
  }

  async function handle(message: unknown): Promise<RpcResponse> {
    if (!isRpcEnvelope(message)) return rpcFail('', 'SCHEMA_INVALID', 'Malformed message.');
    const { requestId, type, protocol, payload } = message;
    if (protocol !== RPC_PROTOCOL) {
      return rpcFail(requestId, 'VERSION_MISMATCH', 'Extension updated — reload this tab.');
    }
    if (!isWorkerRpcType(type))
      return rpcFail(requestId, 'SCHEMA_INVALID', `Unknown message type.`);
    try {
      await deps.migrator.ensure();
      return await dispatch(type, requestId, payload);
    } catch (err) {
      if (err instanceof StoreError) return rpcFail(requestId, err.code, err.message);
      return rpcFail(requestId, 'INTERNAL', 'Unexpected error in the extension background.');
    }
  }

  return { handle };
}

export type RpcServer = ReturnType<typeof createRpcServer>;
