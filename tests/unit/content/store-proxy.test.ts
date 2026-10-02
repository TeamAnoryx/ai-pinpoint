import { createMigrator } from '@background/migrate';
import { createRpcServer } from '@background/rpc-server';
import { RpcCallError, createStoreProxy } from '@content/core/store-proxy';
import { META, REF, newPin } from '../../support/builders';
import { makeHarness } from '../../support/fake-area';

const FAST_TIMEOUT = 20;

function liveServer() {
  const h = makeHarness();
  const server = createRpcServer({
    store: h.store,
    migrator: createMigrator({ area: h.area, now: () => 1, buildBackup: async () => null }),
    transfer: {
      area: h.area,
      locks: h.locks,
      store: h.store,
      now: () => 1,
      extensionVersion: '1',
      broadcast: () => undefined,
    },
  });
  return { h, server };
}

describe('store-proxy', () => {
  test('returns data from a successful call', async () => {
    const { server } = liveServer();
    const proxy = createStoreProxy({ transport: (m) => server.handle(m) });
    await expect(proxy.call('pins:list', REF)).resolves.toEqual([]);
  });

  test('structured errors are thrown with their code and never retried', async () => {
    let attempts = 0;
    const proxy = createStoreProxy({
      transport: async (m) => {
        attempts++;
        return {
          requestId: (m as { requestId: string }).requestId,
          ok: false,
          error: { code: 'QUOTA_EXCEEDED', message: 'full' },
        };
      },
    });
    await expect(proxy.call('pins:list', REF)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(attempts).toBe(1);
  });

  test('a timeout is retried exactly once, with the same requestId', async () => {
    const ids: string[] = [];
    const proxy = createStoreProxy({
      timeoutMs: FAST_TIMEOUT,
      transport: (m) => {
        ids.push((m as { requestId: string }).requestId);
        return new Promise(() => undefined); // worker never answers
      },
    });
    await expect(proxy.call('pins:list', REF)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  test('a disconnected worker is retried and the retry succeeds', async () => {
    const { server } = liveServer();
    let attempts = 0;
    const proxy = createStoreProxy({
      transport: async (m) => {
        attempts++;
        if (attempts === 1)
          throw new Error('Could not establish connection. Receiving end does not exist.');
        return server.handle(m);
      },
    });
    await expect(proxy.call('pins:list', REF)).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });

  test('E15: worker killed after applying the write but before replying → exactly one pin', async () => {
    const { h, server } = liveServer();
    let attempts = 0;
    const proxy = createStoreProxy({
      transport: async (m) => {
        attempts++;
        const res = await server.handle(m);
        if (attempts === 1)
          throw new Error('The message port closed before a response was received.');
        return res;
      },
    });
    const pin = newPin();
    const stored = await proxy.call('pins:add', { ...REF, pin, thread: META });
    expect(stored.pinId).toBe(pin.pinId);
    expect(await h.store.listPins(REF)).toHaveLength(1);
  });

  test('a non-response is DISCONNECTED', async () => {
    const proxy = createStoreProxy({ transport: async () => undefined, retries: 0 });
    await expect(proxy.call('pins:list', REF)).rejects.toBeInstanceOf(RpcCallError);
  });
});
