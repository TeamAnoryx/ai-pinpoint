import {
  CONTENT_RPC_TYPES,
  RPC_PROTOCOL,
  type RpcRequest,
  WORKER_RPC_TYPES,
  isContentRpcType,
  isRpcEnvelope,
  isWorkerRpcType,
  rpcFail,
  rpcOk,
} from '@shared/rpc';

describe('rpc contract', () => {
  test('covers every message in ARCHITECTURE.md §8 plus D-015/D-017 exactly once', () => {
    const all = [...WORKER_RPC_TYPES, ...CONTENT_RPC_TYPES];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(23);
    expect(all).toEqual(
      expect.arrayContaining(['ui:openOptions', 'settings:changed', 'threads:remove', 'storage:wipe', 'ui:status', 'ui:openSidebar']),
    );
  });

  test('type guards partition the message space', () => {
    expect(isWorkerRpcType('pins:add')).toBe(true);
    expect(isContentRpcType('pins:add')).toBe(false);
    expect(isContentRpcType('store:changed')).toBe(true);
    expect(isWorkerRpcType('pins:delete')).toBe(false);
  });

  test('isRpcEnvelope accepts a typed request and rejects malformed input', () => {
    const req: RpcRequest<'pins:list'> = {
      protocol: RPC_PROTOCOL,
      type: 'pins:list',
      requestId: 'r1',
      payload: { hostId: 'claude', threadId: 'claude:1' },
    };
    expect(isRpcEnvelope(req)).toBe(true);
    for (const bad of [
      null,
      'x',
      { type: 'pins:list' },
      { type: 1, requestId: 'r', payload: null },
    ]) {
      expect(isRpcEnvelope(bad)).toBe(false);
    }
  });

  test('response helpers build the envelope', () => {
    expect(rpcOk<'pins:remove'>('r1', { removed: true })).toEqual({
      requestId: 'r1',
      ok: true,
      data: { removed: true },
    });
    expect(rpcFail('r2', 'QUOTA_EXCEEDED', 'full')).toEqual({
      requestId: 'r2',
      ok: false,
      error: { code: 'QUOTA_EXCEEDED', message: 'full' },
    });
  });
});
