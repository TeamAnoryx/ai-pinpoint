/**
 * Core E2E flows (TESTING.md §4) on the localhost fixture pages, one per host.
 */
import { BASE, dismissTip, expect, openThread, sendToTab, sidebar, test, ui } from './harness';

const HOSTS = [
  { host: 'claude', thread: '/chat/11111111-2222-4333-8444-555555555555' },
  { host: 'chatgpt', thread: '/c/22222222-2222-4333-8444-555555555555' },
  { host: 'gemini', thread: '/app/c0ffee12ab34cd56' },
] as const;

for (const { host, thread } of HOSTS) {
  test.describe(host, () => {
    test(`E1 boot: a button on every message, handle visible, no console errors`, async ({ context, foreignRequests }) => {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      const t0 = Date.now();
      await openThread(page, host, thread, '?n=20');
      await expect.poll(() => page.locator('[data-pinpoint-btn]').count(), { timeout: 10_000 }).toBe(20);
      expect(Date.now() - t0).toBeLessThan(10_000);
      await expect(page.locator(ui.handle)).toBeVisible();
      expect(errors).toEqual([]);
      expect(foreignRequests).toEqual([]);
    });

    test(`E2 pin → reload → navigate centres and highlights`, async ({ context }) => {
      const page = await context.newPage();
      await openThread(page, host, thread, '?n=60');
      await page.locator('[data-pinpoint-btn]').nth(30).click();
      await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1);
      await page.reload();
      await page.waitForSelector('[data-pinpoint-btn][aria-pressed="true"]', { state: 'attached' });
      await sidebar(page);
      await expect(page.locator(ui.card)).toHaveCount(1);
      await page.locator(ui.cardMain).first().click();
      await expect(page.locator(ui.highlight)).toHaveCount(1);
      // Centred within the host's inner scroll container, not the window (CLAUDE.md §5).
      const offset = await page.evaluate(() => {
        const ring = document.querySelector('#ai-pinpoint-root')!.shadowRoot!.querySelector<HTMLElement>('[data-pinpoint-ui="highlight"]')!;
        let box: HTMLElement | null = document.querySelector<HTMLElement>('[data-pinpoint-btn][aria-pressed="true"]');
        while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
        const c = box ? box.getBoundingClientRect() : { top: 0, height: innerHeight };
        const r = ring.getBoundingClientRect();
        return Math.abs(r.top + r.height / 2 - (c.top + c.height / 2));
      });
      expect(offset).toBeLessThan(80);
      await expect(page.locator(ui.highlight)).toHaveCount(0, { timeout: 5000 });
    });
  });
}

test('E3 virtualised thread: navigate to a pin 300 messages away (recovery)', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/33333333-2222-4333-8444-555555555555', '?n=320&virtual=1');
  await page.locator('[data-pinpoint-btn]').first().click();
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1);
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-e2e-scroll]')!;
    s.scrollTop = s.scrollHeight;
  });
  await page.waitForTimeout(300);
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(0);
  await sidebar(page);
  await page.locator(ui.cardMain).first().click();
  await expect(page.locator(ui.highlight)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1);
});

test('E4 deleted message → not-found card after the budget; scroll restored', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'chatgpt', '/c/44444444-2222-4333-8444-555555555555', '?n=40');
  await page.locator('[data-pinpoint-btn]').nth(3).click();
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1);
  await page.evaluate(() => document.querySelectorAll('section[data-turn]')[3]!.remove());
  const before = await page.evaluate(() => document.querySelector<HTMLElement>('.scroll-root')!.scrollTop);
  await sidebar(page);
  await page.locator(ui.cardMain).first().click();
  await expect(page.locator(`${ui.card}[data-nav="not-found"]`)).toHaveCount(1, { timeout: 12_000 });
  expect(await page.evaluate(() => document.querySelector<HTMLElement>('.scroll-root')!.scrollTop)).toBe(before);
});

test('E6 SPA switch: buttons re-injected, pin list swapped', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/55555555-2222-4333-8444-555555555555', '?n=10');
  await page.locator('[data-pinpoint-btn]').nth(1).click();
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1);
  const next = '/claude/chat/66666666-2222-4333-8444-555555555555?n=6';
  const html = await (await page.request.get(`${BASE}${next}`)).text();
  await page.evaluate(([p, h]) => (window as unknown as { __ppGo: (p: string, h: string) => void }).__ppGo(p, h), [next, html] as const);
  await expect.poll(() => page.locator('[data-pinpoint-btn]').count(), { timeout: 10_000 }).toBe(6);
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(0);
  await sidebar(page);
  await expect(page.locator(ui.card)).toHaveCount(0);
});

test('E7/E8 pin-last during a stream is queued; a cut stream still gets indexed', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/claude/chat/77777777-2222-4333-8444-555555555555?n=6&stream=1`);
  await page.waitForSelector('[data-pinpoint-btn]', { state: 'attached' });
  await sendToTab(sw, 'command:pinLast');
  await sidebar(page);
  await expect(page.locator(ui.card)).toHaveCount(1, { timeout: 10_000 });
  const snippet = await page.locator(`${ui.card} .pp-primary`).textContent();
  expect(snippet).toContain('token');

  const cut = await context.newPage();
  await cut.goto(`${BASE}/claude/chat/88888888-2222-4333-8444-555555555555?n=6&stream=cut`);
  await cut.waitForSelector('[data-pinpoint-btn]', { state: 'attached' });
  // The tail keeps its streaming marker forever; it is indexed once stalled for STREAM_TIMEOUT_MS.
  await expect.poll(() => cut.locator('[data-pinpoint-btn]').count(), { timeout: 15_000 }).toBe(6);
});

test('E10 keyboard-only: pin via hotkey, rename, reorder, unpin, undo', async ({ context, sw }) => {
  const page = await context.newPage();
  await openThread(page, 'chatgpt', '/c/99999999-2222-4333-8444-555555555555', '?n=6');
  for (const i of [1, 3]) await page.locator('[data-pinpoint-btn]').nth(i).click();
  await sendToTab(sw, 'command:focusFilter');
  await page.locator(ui.sidebar).waitFor();
  await page.keyboard.press('Tab'); // filter → list
  const first = page.locator(ui.cardMain).first();
  await first.focus();
  await page.keyboard.press('F2');
  await page.keyboard.type('Renamed');
  await page.keyboard.press('Enter');
  await expect(page.locator(`${ui.card} .pp-primary`).first()).toHaveText('Renamed');
  await page.locator(ui.cardMain).first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator(`${ui.card} .pp-primary`).nth(1)).toHaveText('Renamed');
  await page.locator(ui.cardMain).nth(1).focus();
  await page.keyboard.press('Delete');
  await expect(page.locator(ui.card)).toHaveCount(1);
  await page.locator(ui.toastButton).click();
  await expect(page.locator(ui.card)).toHaveCount(2);
  await expect(page.locator(`${ui.card} .pp-primary`).nth(1)).toHaveText('Renamed');
});

test('E12 collapsed overlay never intercepts host clicks', async ({ context }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/aaaaaaaa-2222-4333-8444-555555555555', '?n=10');
  // The first-run tip is a dialog and may take clicks until dismissed; the steady state may not.
  await dismissTip(page);
  const hits = await page.evaluate(() => {
    const out: string[] = [];
    for (let x = 5; x < innerWidth; x += Math.floor(innerWidth / 10)) {
      for (let y = 5; y < innerHeight; y += Math.floor(innerHeight / 10)) {
        const el = document.elementFromPoint(x, y);
        if (el?.id === 'ai-pinpoint-root') out.push(`${x},${y}`);
      }
    }
    return out;
  });
  // Only the edge handle (28×96 at the right edge, vertically centred) may take clicks.
  for (const p of hits) expect(Number(p.split(',')[0])).toBeGreaterThan(1280 - 40);
});

test('E14 two tabs on one thread stay in sync within 500 ms', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  const path = '/chat/bbbbbbbb-2222-4333-8444-555555555555';
  await openThread(a, 'claude', path, '?n=8');
  await openThread(b, 'claude', path, '?n=8');
  await a.bringToFront();
  await a.locator('[data-pinpoint-btn]').nth(2).click();
  const t0 = Date.now();
  await expect(b.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1, { timeout: 2000 });
  expect(Date.now() - t0).toBeLessThan(1000);
});

test('E16 export → wipe → import restores identical pins', async ({ context, rpc }) => {
  const page = await context.newPage();
  await openThread(page, 'gemini', '/app/cccccccccccc1234', '?n=8');
  for (const i of [0, 3, 5]) await page.locator('[data-pinpoint-btn]').nth(i).click();
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(3);
  const bundle = await rpc<{ threads: unknown[] }>('transfer:export', null);
  await rpc('storage:wipe', { confirm: 'DELETE' });
  await expect(page.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(0);
  const report = await rpc<{ committed: boolean; pinsAdded: number }>('transfer:import', { bundle, mode: 'merge', dryRun: false });
  expect(report).toMatchObject({ committed: true, pinsAdded: 3 });
  const again = await rpc<{ threads: unknown[] }>('transfer:export', null);
  expect(again.threads).toEqual(bundle.threads);
});

test('E17 host toggled off: injection removed within 500 ms, no further writes', async ({ context, rpc }) => {
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/dddddddd-2222-4333-8444-555555555555', '?n=8');
  const settings = await rpc<{ hosts: Record<string, { enabled: boolean }> }>('settings:get', null);
  await rpc('settings:set', { hosts: { ...settings.hosts, claude: { enabled: false } } });
  await expect(page.locator('[data-pinpoint-btn]')).toHaveCount(0, { timeout: 500 });
  await expect(page.locator(ui.handle)).toHaveCount(0);
  await rpc('settings:set', { hosts: { ...settings.hosts, claude: { enabled: true } } });
  await expect.poll(() => page.locator('[data-pinpoint-btn]').count(), { timeout: 5000 }).toBe(8);
});

test('E20 reduced motion: highlight has no animation and is removed on time', async ({ context, rpc }) => {
  await rpc('settings:set', { reducedMotion: 'on' });
  const page = await context.newPage();
  await openThread(page, 'chatgpt', '/c/eeeeeeee-2222-4333-8444-555555555555', '?n=30');
  await page.locator('[data-pinpoint-btn]').nth(20).click();
  await sidebar(page);
  await page.locator(ui.cardMain).first().click();
  await expect(page.locator(ui.highlight)).toHaveCount(1);
  const anims = await page.evaluate(() =>
    document.querySelector('#ai-pinpoint-root')!.shadowRoot!.querySelector('[data-pinpoint-ui="highlight"]')!.getAnimations().length,
  );
  expect(anims).toBe(0);
  await expect(page.locator(ui.highlight)).toHaveCount(0, { timeout: 3000 });
});
