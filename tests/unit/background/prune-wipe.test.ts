import { entryBytes } from '@background/kv';
import { KEY_PREFIX, threadKey } from '@shared/constants';
import { RPC_PROTOCOL, WIPE_CONFIRMATION } from '@shared/rpc';
import { makeWorker } from '../../support/worker';

const META = { title: 'T', url: 'https://example.test/c/1' };

function pin(id: string) {
  return {
    pinId: id,
    targetHash: `c:${id}:1`,
    nativeId: null,
    role: 'user' as const,
    snippet: `snippet ${id}`,
    textLength: 10,
    ordinal: 1,
    label: null,
    createdAt: 1,
  };
}

async function seed(w: ReturnType<typeof makeWorker>, threads: string[]) {
  for (const t of threads) {
    await w.proxy.call('pins:add', { hostId: 'claude', threadId: t, pin: pin(`${t}-a`), thread: META });
    await w.proxy.call('pins:add', { hostId: 'claude', threadId: t, pin: pin(`${t}-b`), thread: META });
  }
}

describe('threads:remove (prune)', () => {
  test('removes whole threads, rebuilds the index, and reports exact reclaimed bytes', async () => {
    const w = makeWorker();
    await seed(w, ['claude:t1', 'claude:t2', 'claude:t3']);
    const expected = ['claude:t1', 'claude:t3'].reduce((sum, t) => {
      const k = threadKey('claude', t);
      return sum + entryBytes(k, JSON.parse(w.area.data.get(k)!));
    }, 0);
    const res = await w.proxy.call('threads:remove', { hostId: 'claude', threadIds: ['claude:t1', 'claude:t3', 'claude:missing'] });
    expect(res).toEqual({ removed: 2, bytesReclaimed: expected });
    const threads = await w.proxy.call('threads:list', { hostId: 'claude' });
    expect(threads.map((t) => t.threadId)).toEqual(['claude:t2']);
    expect(w.broadcasts).toEqual(expect.arrayContaining([{ hostId: 'claude', threadId: 'claude:t1' }]));
  });

  test('rejects malformed payloads', async () => {
    const w = makeWorker();
    const res = await w.server.handle({ protocol: RPC_PROTOCOL, type: 'threads:remove', requestId: 'x', payload: { hostId: 'claude', threadIds: 'nope' } });
    expect(res).toMatchObject({ ok: false, error: { code: 'SCHEMA_INVALID' } });
  });
});

describe('storage:wipe', () => {
  test('requires the typed confirmation', async () => {
    const w = makeWorker();
    await seed(w, ['claude:t1']);
    const res = await w.server.handle({ protocol: RPC_PROTOCOL, type: 'storage:wipe', requestId: 'x', payload: { confirm: 'delete' } });
    expect(res).toMatchObject({ ok: false, error: { code: 'SCHEMA_INVALID' } });
    expect(w.area.data.size).toBeGreaterThan(0);
  });

  test('clears every pp:v1:* key and leaves settings at defaults afterwards', async () => {
    const w = makeWorker();
    await seed(w, ['claude:t1', 'claude:t2']);
    await w.proxy.call('settings:set', { theme: 'dark' });
    w.area.data.set('unrelated', '"kept"');
    const res = await w.proxy.call('storage:wipe', { confirm: WIPE_CONFIRMATION });
    expect(res.removedKeys).toBeGreaterThan(3);
    expect([...w.area.data.keys()].filter((k) => k.startsWith(KEY_PREFIX))).toEqual([]);
    expect(w.area.data.has('unrelated')).toBe(true);
    expect((await w.proxy.call('settings:get', null)).theme).toBe('auto');
    expect(await w.proxy.call('pins:list', { hostId: 'claude', threadId: 'claude:t1' })).toEqual([]);
  });
});
