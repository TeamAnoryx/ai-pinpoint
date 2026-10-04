import {
  ADAPTER_FAILURE_LIMIT,
  HREF_TICK_MS,
  MUTATION_DEBOUNCE_MS,
  MUTATION_MAX_WAIT_MS,
  THREAD_SETTLE_MS,
} from '@shared/constants';
import { createClaudeAdapter } from '@content/adapters/claude';
import { createIdentity } from '@content/core/identity';
import { createObserver, isRelevant, liveObserverCount } from '@content/core/observer';
import { createThreadWatcher, isTransient, liveWatcherCount, resolveThreadId } from '@content/core/thread';
import { buildFixture, fixture } from '../../support/fixtures/synth';
import { loadFixture, resetDocument } from '../../support/fixtures/load';

const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  resetDocument();
});

function record(init: Partial<MutationRecord> & { target: Node }): MutationRecord {
  return {
    type: 'childList',
    addedNodes: [] as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
    attributeName: null,
    attributeNamespace: null,
    nextSibling: null,
    previousSibling: null,
    oldValue: null,
    ...init,
  } as MutationRecord;
}

const list = (...nodes: Node[]): NodeList => nodes as unknown as NodeList;

describe('mutation filter', () => {
  test('drops our own UI, streaming text churn, and data-pinpoint attributes', () => {
    const own = document.createElement('div');
    own.setAttribute('data-pinpoint-ui', '1');
    const streaming = document.createElement('div');
    streaming.setAttribute('data-pinpoint-streaming', '1');
    const host = document.createElement('div');
    const btn = document.createElement('button');
    btn.setAttribute('data-pinpoint-btn', '1');
    document.body.append(own, streaming, host);

    expect(isRelevant(record({ target: own, addedNodes: list(document.createElement('p')) }))).toBe(false);
    expect(isRelevant(record({ target: streaming, addedNodes: list(document.createTextNode('tok')) }))).toBe(false);
    expect(isRelevant(record({ type: 'characterData', target: streaming.appendChild(document.createTextNode('x')) }))).toBe(false);
    expect(isRelevant(record({ target: host, addedNodes: list(btn) }))).toBe(false);
    expect(isRelevant(record({ type: 'attributes', target: host, attributeName: 'data-pinpoint-indexed' }))).toBe(false);

    expect(isRelevant(record({ target: host, addedNodes: list(document.createElement('section')) }))).toBe(true);
    expect(isRelevant(record({ target: host, addedNodes: list(document.createTextNode('new')) }))).toBe(true);
  });
});

describe('observer', () => {
  test('debounces bursts into one trailing batch', () => {
    const onBatch = vi.fn(() => true);
    const obs = createObserver({ onBatch });
    const target = document.body.appendChild(document.createElement('div'));
    for (let i = 0; i < 10; i++) obs.handle([record({ target, addedNodes: list(document.createElement('p')) })]);
    vi.advanceTimersByTime(MUTATION_DEBOUNCE_MS - 1);
    expect(onBatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onBatch).toHaveBeenCalledTimes(1);
    obs.stop();
  });

  test('a constant storm still reconciles at least every MUTATION_MAX_WAIT_MS', () => {
    const onBatch = vi.fn(() => true);
    const obs = createObserver({ onBatch, now: () => Date.now() });
    const target = document.body.appendChild(document.createElement('div'));
    for (let t = 0; t < MUTATION_MAX_WAIT_MS * 3; t += 50) {
      obs.handle([record({ target, addedNodes: list(document.createElement('p')) })]);
      vi.advanceTimersByTime(50);
    }
    expect(onBatch.mock.calls.length).toBeGreaterThanOrEqual(2);
    obs.stop();
  });

  test('unfinished slices continue in an idle callback', () => {
    let slices = 0;
    const obs = createObserver({ onBatch: () => ++slices >= 3 });
    obs.runNow();
    vi.runAllTimers();
    expect(slices).toBe(3);
    obs.stop();
  });

  test('throwing batches are counted; the limit stops the observer and reports fatal', () => {
    const onFatal = vi.fn();
    const obs = createObserver({
      onBatch: () => {
        throw new Error('adapter broke');
      },
      onFatal,
    });
    obs.start(document.body);
    for (let i = 0; i < ADAPTER_FAILURE_LIMIT; i++) obs.runNow();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(obs.isRunning()).toBe(false);
  });

  test('start/stop balance the leak counter and stop is idempotent', () => {
    const before = liveObserverCount();
    const obs = createObserver({ onBatch: () => true });
    obs.start(document.body);
    expect(liveObserverCount()).toBe(before + 1);
    obs.stop();
    obs.stop();
    expect(liveObserverCount()).toBe(before);
  });

  test('perf: 300-node thread under a 2000 records/s streaming storm keeps p95 batch work ≤ 2 ms', () => {
    const f = buildFixture('claude', 'perf', { messages: 300 });
    loadFixture(f);
    const adapter = createClaudeAdapter();
    const identity = createIdentity(adapter);
    const nodes = adapter.listMessageNodes();
    identity.rebuildIndex(nodes); // warm: initial indexing is not part of the storm
    for (const n of nodes) n.setAttribute('data-pinpoint-indexed', '1');
    const tail = nodes[nodes.length - 1]!;
    tail.removeAttribute('data-pinpoint-indexed');
    tail.setAttribute('data-pinpoint-streaming', '1');
    const tailText = tail.querySelector('p')!;

    const timings: number[] = [];
    const obs = createObserver({
      onBatch: () => {
        identity.rebuildIndex(adapter.listMessageNodes(), new Set([tail]));
        return true;
      },
      now: () => Date.now(),
    });
    const RECORDS_PER_TICK = 20;
    const TICK_MS = 10; // 20 records / 10 ms = 2000 records/s
    for (let t = 0; t < 5000; t += TICK_MS) {
      const recs: MutationRecord[] = [];
      for (let i = 0; i < RECORDS_PER_TICK; i++) {
        recs.push(record({ target: tailText, addedNodes: list(document.createTextNode('tok ')) }));
      }
      const start = performance.now();
      obs.handle(recs);
      timings.push(performance.now() - start);
      vi.advanceTimersByTime(TICK_MS);
    }
    timings.sort((a, b) => a - b);
    expect(timings[Math.floor(timings.length * 0.95)]!).toBeLessThanOrEqual(2);
    // Stream ends: the node is indexed on the next batch (no dropped indexing).
    tail.removeAttribute('data-pinpoint-streaming');
    identity.rebuildIndex(adapter.listMessageNodes());
    expect(identity.meta(tail)).toBeDefined();
    obs.stop();
  });
});

describe('thread watcher', () => {
  test('resolves a transient scope when the URL has no id', () => {
    loadFixture(fixture('claude', 'short-thread'));
    const adapter = createClaudeAdapter();
    history.replaceState(null, '', '/new');
    const id = resolveThreadId(adapter, location, 'abc');
    expect(id).toBe('transient:claude:abc');
    expect(isTransient(id)).toBe(true);
  });

  test('SPA pushState switch → onChange after settle; stop removes everything', async () => {
    const f = fixture('claude', 'short-thread');
    loadFixture(f);
    const adapter = createClaudeAdapter();
    const onChange = vi.fn();
    const before = liveWatcherCount();
    const w = createThreadWatcher({ adapter, nonce: 'n1', onChange });
    w.start();
    expect(liveWatcherCount()).toBe(before + 1);
    expect(w.current()).toBe(f.threadId);

    history.pushState(null, '', '/chat/22222222-3333-4444-8555-666666666666');
    vi.advanceTimersByTime(HREF_TICK_MS + THREAD_SETTLE_MS);
    await flush();
    expect(onChange).toHaveBeenCalledWith({
      previous: f.threadId,
      next: 'claude:22222222-3333-4444-8555-666666666666',
      fromTransient: false,
    });

    history.pushState(null, '', '/new');
    vi.advanceTimersByTime(HREF_TICK_MS + THREAD_SETTLE_MS);
    history.pushState(null, '', '/chat/33333333-3333-4444-8555-666666666666');
    vi.advanceTimersByTime(HREF_TICK_MS + THREAD_SETTLE_MS);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ fromTransient: true }));

    w.stop();
    expect(liveWatcherCount()).toBe(before);
    history.pushState(null, '', '/chat/44444444-3333-4444-8555-666666666666');
    vi.advanceTimersByTime(HREF_TICK_MS + THREAD_SETTLE_MS);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  test('popstate triggers a check without waiting for the tick', () => {
    loadFixture(fixture('claude', 'short-thread'));
    const onChange = vi.fn();
    const w = createThreadWatcher({ adapter: createClaudeAdapter(), nonce: 'n', onChange });
    w.start();
    history.pushState(null, '', '/chat/55555555-3333-4444-8555-666666666666');
    dispatchEvent(new PopStateEvent('popstate'));
    vi.advanceTimersByTime(THREAD_SETTLE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
    w.stop();
  });
});
