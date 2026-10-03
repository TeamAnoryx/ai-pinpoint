/**
 * Phase 8 E2E (TESTING.md §4): abort, drag reorder, host-CSS isolation, quota, worker restart,
 * extension update, and the 300-message navigation trials.
 */
import { dismissTip, expect, openThread, sidebar, test, ui } from './harness';
import { diffRatio } from './png-diff';
import { cardTexts, navState, pinAt, scrollToEnd, scrollTopOf } from './helpers';

test('E5 user scroll during recovery aborts within 200 ms and restores the scroll position', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/e5e5e5e5-2222-4333-8444-555555555555', '?n=320&virtual=1');
  await pinAt(page, 0);
  await scrollToEnd(page);
  const before = await scrollTopOf(page);
  await sidebar(page);
  await page.locator(ui.cardMain).first().click();
  await expect.poll(() => navState(page)).toBe('locating');
  const box = (await page.locator('[data-e2e-scroll]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
  const t0 = Date.now();
  await page.mouse.wheel(0, -120);
  await expect.poll(() => navState(page), { timeout: 1000, intervals: [20] }).toBe('idle');
  expect(Date.now() - t0).toBeLessThan(400); // 200 ms budget + Playwright polling overhead
  await expect(page.locator(ui.highlight)).toHaveCount(0);
  // Restored to where the user was; the wheel itself may move it by one notch.
  expect(Math.abs((await scrollTopOf(page)) - before)).toBeLessThanOrEqual(120);
});

test('E9 reorder by drag, then reload: order preserved', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'chatgpt', '/c/e9e9e9e9-2222-4333-8444-555555555555', '?n=8');
  for (const i of [1, 3, 5]) await page.locator('[data-pinpoint-btn]').nth(i).click();
  await sidebar(page);
  await expect(page.locator(ui.card)).toHaveCount(3);
  const before = await cardTexts(page);
  const handle = page.locator(`${ui.card} .pp-drag`).first();
  const last = (await page.locator(ui.card).nth(2).boundingBox())!;
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, last.y + last.height - 4, { steps: 8 });
  await page.mouse.up();
  const expected = [before[1], before[2], before[0]];
  await expect.poll(() => cardTexts(page)).toEqual(expected);
  await page.reload();
  await page.waitForSelector('[data-pinpoint-btn][aria-pressed="true"]', { state: 'attached' });
  await sidebar(page);
  await expect.poll(() => cardTexts(page)).toEqual(expected);
});

test('E11 aggressive host CSS leaves the overlay unchanged', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'gemini', '/app/e11e11e11e11e11e', '?n=6');
  // Only the first message: it stays in view however the host restyles, so the card's
  // "in view" marker (legitimately host-dependent) does not change between the two shots.
  await page.locator('[data-pinpoint-btn]').nth(0).click();
  await dismissTip(page);
  await sidebar(page);
  await expect(page.locator('#ai-pinpoint-root .pp-toast')).toHaveCount(0, { timeout: 10_000 });
  // Clip inside the sidebar: its rounded corners and shadow show host pixels by design.
  const bb = (await page.locator(ui.sidebar).boundingBox())!;
  const clip = { x: bb.x + 12, y: bb.y + 12, width: bb.width - 24, height: bb.height - 24 };
  const shot = (): Promise<Buffer> => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  const baseline = await shot();
  await page.addStyleTag({
    content: `
      *, *::before, *::after { font: 700 31px/3 serif !important; color: red !important; letter-spacing: 4px !important;
        box-sizing: content-box !important; text-transform: uppercase !important; }
      div, span, button, li, ul, input { background: lime !important; border: 5px solid blue !important;
        padding: 9px !important; margin: 7px !important; display: block !important; }
      :root { --pp-bg: red; --pp-fg: lime; --pp-accent: yellow; --pp-font: serif; }`,
  });
  await page.waitForTimeout(100);
  expect(diffRatio(baseline, await shot())).toBeLessThanOrEqual(0.001); // TESTING §4: 0.1%
});

test('E13 storage at 96%: new pin rejected with the quota banner, existing pins intact', async ({ context, sw }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/e13e13e1-2222-4333-8444-555555555555', '?n=6');
  await page.locator('[data-pinpoint-btn]').nth(0).click();
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1);
  await sw.evaluate(async () => {
    const quota = chrome.storage.local.QUOTA_BYTES;
    const used = await chrome.storage.local.getBytesInUse(null);
    await chrome.storage.local.set({ 'zz-e2e-filler': 'x'.repeat(Math.floor(quota * 0.96) - used) });
  });
  await page.locator('[data-pinpoint-btn]').nth(2).click();
  await expect(page.locator(`#ai-pinpoint-root .pp-toast, #ai-pinpoint-root .pp-banner`).filter({ hasText: 'Storage full' }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1);
  await sidebar(page);
  await expect(page.locator(ui.card)).toHaveCount(1);
  await sw.evaluate(() => chrome.storage.local.remove('zz-e2e-filler'));
});

test('E15 worker force-stopped, then pin: succeeds after wake, exactly one pin', async ({ context, rpc }) => {
  const page = await context.newPage();
  await openThread(page, 'chatgpt', '/c/e15e15e1-2222-4333-8444-555555555555', '?n=6');
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await page.locator('[data-pinpoint-btn]').nth(1).click();
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1, { timeout: 10_000 });
  const bundle = await rpc<{ threads: { pins: unknown[] }[] }>('transfer:export', null);
  expect(bundle.threads.flatMap((t) => t.pins)).toHaveLength(1);
});

test('E18 extension updated under a live tab: content script tears down and asks for a reload', async ({ context, sw }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/e18e18e1-2222-4333-8444-555555555555', '?n=6');
  await sw.evaluate(() => chrome.runtime.reload()).catch(() => undefined);
  await page.waitForTimeout(500);
  await page.locator('[data-pinpoint-btn]').nth(1).click();
  await expect(page.locator('#ai-pinpoint-root').getByText('Extension updated — reload this tab.').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-pinpoint-btn]')).toHaveCount(0);
});

const TRIALS = Number(process.env['E19_TRIALS'] ?? 100);
const E19_HOSTS = [
  { host: 'claude', thread: '/chat/e19e19e1-2222-4333-8444-555555555555' },
  { host: 'chatgpt', thread: '/c/e19e19e1-2222-4333-8444-555555555555' },
  { host: 'gemini', thread: '/app/e19e19e19e19e19e' },
] as const;

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? 0;
}

for (const { host, thread } of E19_HOSTS) {
  test(`E19 ${host}: ${TRIALS} navigations to random pins on a 300-message thread`, async ({ context }) => {
    test.setTimeout(20 * 60_000);
    const page = await context.newPage();
    await openThread(page, host, thread, '?n=300&virtual=1');
    const fractions = [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
    for (const f of fractions) await pinAt(page, f);
    await sidebar(page);
    await expect(page.locator(ui.card)).toHaveCount(fractions.length);

    let seed = 0x5eed;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const mounted: number[] = [];
    const unmounted: number[] = [];
    let ok = 0;
    let prev = -1;
    for (let i = 0; i < TRIALS; i++) {
      const idx = rand(fractions.length);
      const snippet = ((await page.locator(`${ui.card} .pp-primary`).nth(idx).textContent()) ?? '').slice(0, 40);
      const wasMounted = await page.evaluate(
        (text) => [...document.querySelectorAll('[data-e2e-row]')].some((r) => (r.textContent ?? '').includes(text)),
        snippet,
      );
      await expect(page.locator(ui.highlight)).toHaveCount(0, { timeout: 5000 });
      const t0 = Date.now();
      await page.locator(ui.cardMain).nth(idx).click();
      const trace: string[] = [];
      let found = false;
      while (!found && Date.now() - t0 < 10_000) {
        found = (await page.locator(ui.highlight).count()) > 0;
        if (!found) trace.push(`${await navState(page, idx)}@${Math.round(await scrollTopOf(page))}`);
      }
      if (found) {
        ok++;
        (wasMounted ? mounted : unmounted).push(Date.now() - t0);
      } else {
        const steps = trace.filter((t, k) => k === 0 || t !== trace[k - 1]).slice(0, 12).join(' > ');
        console.log(`E19 ${host} miss: trial ${i}, pin #${idx} (${fractions[idx]}) after #${prev}: ${steps}`);
      }
      prev = idx;
    }
    console.log(`E19 ${host}: ${ok}/${TRIALS}, p95 mounted ${p95(mounted)} ms, p95 unmounted ${p95(unmounted)} ms`);
    expect(ok / TRIALS).toBeGreaterThanOrEqual(0.99);
    expect(p95(mounted)).toBeLessThanOrEqual(2500);
    expect(p95(unmounted)).toBeLessThanOrEqual(6000);
  });
}
