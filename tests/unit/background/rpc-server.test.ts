import { createMigrator } from '@background/migrate';
import { createRpcServer } from '@background/rpc-server';
import { META_KEY } from '@shared/constants';
import { RPC_PROTOCOL, type RpcResponse } from '@shared/rpc';
import { SCHEMA_VERSION } from '@shared/schema';
import { META, REF, newPin } from '../../support/builders';
import { type Harness, makeHarness } from '../../support/fake-area';

function setup(h: Harness = makeHarness()) {
  const migrator = createMigrator({ area: h.area, now: () => 1, buildBackup: async () => null });
  const server = createRpcServer({
    store: h.store,
    migrator,
    transfer: {
      area: h.area,
      locks: h.locks,
      store: h.store,
      now: () => 1,
      extensionVersion: '1.0.0',
      broadcast: () => undefined,
    },
  });
  let n = 0;
  const send = (
    type: string,
    payload: unknown,
    protocol: unknown = RPC_PROTOCOL,
  ): Promise<RpcResponse> => server.handle({ protocol, type, requestId: `r${++n}`, payload });
  return { h, migrator, server, send };
}

function errorCode(res: RpcResponse): string | null {
  return res.ok ? null : res.error.code;
}

describe('rpc-server', () => {
  test('happy path: add, list, update, remove through the router', async () => {
    const { send } = setup();
    const pin = newPin();
    const added = await send('pins:add', { ...REF, pin, thread: META });
    expect(added).toMatchObject({ ok: true, requestId: 'r1' });
    const listed = await send('pins:list', REF);
    expect(listed.ok && listed.data).toHaveLength(1);
    expect(
      (await send('pins:update', { ...REF, pinId: pin.pinId, patch: { label: 'L' } })).ok,
    ).toBe(true);
    expect(await send('pins:remove', { ...REF, pinId: pin.pinId })).toMatchObject({
      ok: true,
      data: { removed: true },
    });
  });

  test('malformed envelopes and unknown types are SCHEMA_INVALID', async () => {
    const { server, send } = setup();
    expect(errorCode(await server.handle(null))).toBe('SCHEMA_INVALID');
    expect(errorCode(await server.handle({ type: 'pins:list' }))).toBe('SCHEMA_INVALID');
    expect(errorCode(await send('pins:delete', REF))).toBe('SCHEMA_INVALID');
    expect(errorCode(await send('store:changed', REF))).toBe('SCHEMA_INVALID');
  });

  test('a different protocol version is VERSION_MISMATCH (EDGE_CASES.md §19)', async () => {
    const { send } = setup();
    expect(errorCode(await send('pins:list', REF, RPC_PROTOCOL + 1))).toBe('VERSION_MISMATCH');
    expect(errorCode(await send('pins:list', REF, null))).toBe('VERSION_MISMATCH');
  });

  test.each([
    ['bad host', 'pins:list', { hostId: 'bard', threadId: 'x' }],
    ['transient thread', 'pins:list', { hostId: 'claude', threadId: 'transient:claude:abc' }],
    ['missing pin', 'pins:add', { ...REF, thread: META }],
    [
      'non-https url',
      'pins:add',
      { ...REF, pin: newPin(), thread: { title: null, url: 'javascript:alert(1)' } },
    ],
    ['bad role', 'pins:add', { ...REF, pin: { ...newPin(), role: 'system' }, thread: META }],
    ['bad patch', 'pins:update', { ...REF, pinId: 'p', patch: { label: 5 } }],
    ['bad orderedIds', 'pins:reorder', { ...REF, orderedIds: 'p1,p2' }],
    ['bad mode', 'transfer:import', { bundle: {}, mode: 'overwrite', dryRun: false }],
    ['settings not object', 'settings:set', 'dark'],
  ])('invalid payload (%s) is SCHEMA_INVALID and writes nothing', async (_name, type, payload) => {
    const { h, send } = setup();
    await send('settings:get', null); // let migrations write meta first
    const before = h.area.snapshot();
    expect(errorCode(await send(type, payload))).toBe('SCHEMA_INVALID');
    expect(h.area.snapshot()).toEqual(before);
  });

  test('worker-assigned pin fields cannot be smuggled in by the caller', async () => {
    const { send } = setup();
    const res = await send('pins:add', {
      ...REF,
      pin: { ...newPin(), order: -5, repairCount: 99, evil: 'x' },
      thread: META,
    });
    expect(res.ok && res.data).toMatchObject({ order: 100, repairCount: 0 });
    expect(res.ok && res.data).not.toHaveProperty('evil');
  });

  test('migrations run before the first request; newer schema makes writes READ_ONLY', async () => {
    const h = makeHarness();
    h.area.seed({
      [META_KEY]: { schema: SCHEMA_VERSION + 1, installedAt: 1, lastMigratedFrom: null },
    });
    const { send, migrator } = setup(h);
    // Wire the store's read-only flag to the migrator, as index.ts does.
    Object.defineProperty(h.readOnly, 'value', { get: () => migrator.state().readOnly });
    expect((await send('pins:list', REF)).ok).toBe(true);
    expect(migrator.state().readOnly).toBe(true);
    expect(errorCode(await send('pins:add', { ...REF, pin: newPin(), thread: META }))).toBe(
      'READ_ONLY',
    );
  });

  test('unexpected exceptions become INTERNAL without leaking details', async () => {
    const { h, send } = setup();
    h.area.get = async () => {
      throw new TypeError('secret internal detail');
    };
    const res = await send('pins:list', REF);
    expect(errorCode(res)).toBe('INTERNAL');
    expect(JSON.stringify(res)).not.toContain('secret');
  });
});

describe('rpc-server D-015 messages', () => {
  test('ui:openOptions calls the injected opener and settings:set notifies listeners', async () => {
    const h = makeHarness();
    const opened: number[] = [];
    const changed: unknown[] = [];
    const server = createRpcServer({
      store: h.store,
      migrator: createMigrator({ area: h.area, now: () => 1, buildBackup: async () => null }),
      transfer: { area: h.area, locks: h.locks, store: h.store, now: () => 1, extensionVersion: '1.0.0', broadcast: () => undefined },
      openOptions: async () => {
        opened.push(1);
      },
      onSettingsChanged: (s) => changed.push(s),
    });
    const res = await server.handle({ protocol: RPC_PROTOCOL, type: 'ui:openOptions', requestId: 'a', payload: null });
    expect(res).toMatchObject({ ok: true, data: { ack: true } });
    expect(opened).toHaveLength(1);
    await server.handle({ protocol: RPC_PROTOCOL, type: 'settings:set', requestId: 'b', payload: { theme: 'dark' } });
    expect(changed).toEqual([expect.objectContaining({ theme: 'dark' })]);
  });
});
