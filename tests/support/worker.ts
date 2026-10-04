/**
 * The real service-worker store + RPC server over an in-memory area, exposed to content-side
 * code through the real store proxy (transport = direct call).
 */
import { createMigrator } from '@background/migrate';
import { createRpcServer } from '@background/rpc-server';
import { createStoreProxy } from '@content/core/store-proxy';
import { FakeArea, makeHarness } from './fake-area';

export function makeWorker() {
  const h = makeHarness(new FakeArea(10_485_760, false));
  const migrator = createMigrator({ area: h.area, now: () => 1, buildBackup: async () => null });
  const server = createRpcServer({
    store: h.store,
    migrator,
    transfer: { area: h.area, locks: h.locks, store: h.store, now: () => 1, extensionVersion: '1.0.0', broadcast: () => undefined },
  });
  const calls: string[] = [];
  const proxy = createStoreProxy({
    transport: (message) => {
      calls.push((message as { type: string }).type);
      return server.handle(message);
    },
  });
  return { ...h, server, proxy, calls };
}
