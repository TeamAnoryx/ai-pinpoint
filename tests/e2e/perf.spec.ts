/**
 * Performance and memory budgets (TESTING.md §5) on the 300-message virtualising fixture.
 * P5 (listener/observer leak counters) and P6/P7 (bundle size) are covered by unit tests and
 * `verify:size`; this file measures what needs a real browser.
 */
import { BASE, expect, openThread, test } from './harness';

/** Storm cadence: 20 mutations per tick → ~2000 records/s (TESTING.md §5, P2). */
const STORM_TICK_MS = 10;
const STORM_DRAIN_MS = 500;

const THREAD = '/claude/chat/9e4f0000-2222-4333-8444-555555555555';

test('P8 time-to-first-button ≤ 1.5 s after DOMContentLoaded (300 messages)', async ({ context }) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __firstButton?: number };
    new MutationObserver((_, obs) => {
      if (document.querySelector('[data-pinpoint-btn]')) {
        w.__firstButton = performance.now();
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${BASE}${THREAD}?n=300&virtual=1`);
  await page.waitForSelector('[data-pinpoint-btn]', { state: 'attached' });
  const ms = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return (window as unknown as { __firstButton: number }).__firstButton - nav.domContentLoadedEventEnd;
  });
  console.log(`P8 time-to-first-button: ${Math.round(ms)} ms`);
  expect(ms).toBeLessThanOrEqual(1500);
});

test('P3 injection latency after a message completes ≤ 400 ms', async ({ context }) => {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __done?: number; __tailButton?: number };
      document.addEventListener('e2e:stream-done', () => {
        w.__done = performance.now();
        // Every message has a ready (not busy) button once the completed tail is indexed.
        const tick = (): void => {
          const btns = document.querySelectorAll('[data-pinpoint-btn]');
          const ready = btns.length === 6 && !document.querySelector('[data-pinpoint-btn][aria-busy="true"]');
          if (ready) w.__tailButton = performance.now();
          else requestAnimationFrame(tick);
        };
        tick();
      });
    });
    await page.goto(`${BASE}/claude/chat/9e4f000${i}-2222-4333-8444-555555555555?n=6&stream=1`);
    await page.waitForFunction(() => (window as unknown as { __tailButton?: number }).__tailButton !== undefined, null, { timeout: 15_000 });
    samples.push(await page.evaluate(() => {
      const w = window as unknown as { __done: number; __tailButton: number };
      return w.__tailButton - w.__done;
    }));
    await page.close();
  }
  samples.sort((a, b) => a - b);
  console.log(`P3 injection latency samples: ${samples.map(Math.round).join(', ')} ms`);
  expect(samples[samples.length - 1]).toBeLessThanOrEqual(400);
});

test('P1 idle: near-zero script time with no mutations', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', `${THREAD.replace('/claude', '')}`, '?n=300&virtual=1');
  await page.waitForTimeout(2000); // boot reconcile done
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async (): Promise<number> =>
    (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'ScriptDuration')!.value;
  const before = await metric();
  await page.waitForTimeout(10_000);
  const busy = (await metric()) - before;
  console.log(`P1 idle script time over 10 s: ${(busy * 1000).toFixed(1)} ms`);
  expect(busy).toBeLessThan(0.1); // < 1% of the window
});

test('P2 mutation storm: no long task, every node indexed afterwards', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/9e4f00aa-2222-4333-8444-555555555555', '?n=60');
  await expect.poll(() => page.locator('[data-pinpoint-btn]').count()).toBe(60);
  const longest = await page.evaluate(async ([tick, drain]) => {
    let max = 0;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) max = Math.max(max, e.duration);
    });
    obs.observe({ type: 'longtask', buffered: false });
    const targets = [...document.querySelectorAll<HTMLElement>('[data-testid="transcript-row"] p')];
    const end = performance.now() + 5000;
    // ~2000 records/s: 20 mutations every 10 ms across the transcript.
    while (performance.now() < end) {
      for (let i = 0; i < 20; i++) {
        const p = targets[(Math.random() * targets.length) | 0]!;
        const s = document.createElement('span');
        s.textContent = 'x';
        p.append(s);
        s.remove();
      }
      await new Promise((r) => setTimeout(r, tick));
    }
    await new Promise((r) => setTimeout(r, drain));
    obs.disconnect();
    return max;
  }, [STORM_TICK_MS, STORM_DRAIN_MS] as const);
  console.log(`P2 longest task during the storm: ${Math.round(longest)} ms`);
  expect(longest).toBe(0); // no task ≥ 50 ms (the longtask threshold)
  await expect.poll(() => page.locator('[data-pinpoint-btn]').count()).toBe(60);
});

test('P4 retained heap after 10 thread switches grows < 1 MB', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/9e4f0100-2222-4333-8444-555555555555', '?n=40');
  const cdp = await context.newCDPSession(page);
  const heap = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(200);
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  const go = async (i: number): Promise<void> => {
    const next = `/claude/chat/9e4f01${(i % 2).toString().padStart(2, '0')}-2222-4333-8444-555555555555?n=40`;
    const html = await (await page.request.get(`${BASE}${next}`)).text();
    await page.evaluate(([p, h]) => (window as unknown as { __ppGo: (p: string, h: string) => void }).__ppGo(p, h), [next, html] as const);
    await expect.poll(() => page.locator('[data-pinpoint-btn]').count()).toBe(40);
  };
  await go(1);
  await go(0);
  const baseline = await heap();
  for (let i = 1; i <= 10; i++) await go(i);
  const growth = (await heap()) - baseline;
  console.log(`P4 heap growth after 10 switches: ${(growth / 1024).toFixed(0)} KB`);
  expect(growth).toBeLessThan(1024 * 1024);
});
