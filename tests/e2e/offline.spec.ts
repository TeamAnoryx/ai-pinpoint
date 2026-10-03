/**
 * Offline matrix (TESTING.md §6, blocking): the page is loaded, then the browser goes offline
 * and every operation runs. O19 is the decisive check: zero requests from the extension.
 */
import type { Request } from '@playwright/test';
import { BASE, dismissTip, expect, openThread, sendToTab, sidebar, test, ui } from './harness';
import { cardTexts, navState, pinAt, scrollToEnd, scrollTopOf } from './helpers';

test('offline matrix O1–O19', async ({ context, sw, extensionId, foreignRequests }) => {
  test.setTimeout(5 * 60_000);
  const t0 = Date.now();
  const step = (name: string, body: () => Promise<void>): Promise<void> =>
    test.step(name, async () => {
      console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name}`);
      await body();
    });
  const extensionRequests: string[] = [];
  const onRequest = (r: Request): void => {
    // The worker or an extension page reaching anything but the extension's own packaged files
    // is a network call.
    const fromExtension = r.serviceWorker() !== null || r.frame()?.url().startsWith('chrome-extension://') === true;
    if (fromExtension && !r.url().startsWith('chrome-extension://')) extensionRequests.push(r.url());
  };
  context.on('request', onRequest);
  const errors: string[] = [];

  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openThread(page, 'claude', '/chat/0ff1ae00-2222-4333-8444-555555555555', '?n=320&virtual=1');
  await dismissTip(page);
  await context.setOffline(true);

  await step('O1 expand/collapse sidebar', async () => {
    await sidebar(page);
    await page.locator('#ai-pinpoint-root .pp-sidebar [aria-label^="Collapse"], #ai-pinpoint-root .pp-sidebar [aria-label^="Close"]').first().click();
    await expect(page.locator(ui.sidebar)).toHaveCount(0);
    await sidebar(page);
  });

  await step('O2 pin rendered messages (persisted)', async () => {
    await pinAt(page, 0);
    await pinAt(page, 0.5);
    await scrollToEnd(page);
    await pinAt(page, 1);
    await expect(page.locator(ui.card)).toHaveCount(3);
  });

  await step('O3 unpin, then undo', async () => {
    await page.locator(ui.cardMain).nth(2).focus();
    await page.keyboard.press('Delete');
    await expect(page.locator(ui.card)).toHaveCount(2);
    await page.locator(ui.toastButton).click();
    await expect(page.locator(ui.card)).toHaveCount(3);
  });

  await step('O4 add a label', async () => {
    await page.locator(ui.cardMain).first().focus();
    await page.keyboard.press('F2');
    await page.keyboard.type('Offline label');
    await page.keyboard.press('Enter');
    await expect(page.locator(`${ui.card} .pp-primary`).first()).toHaveText('Offline label');
  });

  await step('O5 reorder with Alt+Down (drag is E9)', async () => {
    await page.locator(ui.cardMain).first().focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => cardTexts(page)).toEqual([expect.any(String), 'Offline label', expect.any(String)]);
  });

  await step('O6 filter pins', async () => {
    const filter = page.locator('#ai-pinpoint-root .pp-filter input');
    await filter.fill('Offline');
    await expect(page.locator(ui.card)).toHaveCount(1);
    await filter.fill('');
    await expect(page.locator(ui.card)).toHaveCount(3);
  });

  await step('O7 navigate to a mounted pin', async () => {
    const last = (await cardTexts(page)).length - 1;
    await page.locator(ui.cardMain).nth(last).click(); // pinned at the end, where we are
    await expect(page.locator(ui.highlight)).toHaveCount(1);
    await expect(page.locator(ui.highlight)).toHaveCount(0, { timeout: 5000 });
  });

  await step('O8 navigate to an unmounted pin (recovery)', async () => {
    await page.locator(ui.cardMain).nth(1).click(); // "Offline label", pinned at the top
    await expect(page.locator(ui.highlight)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator(ui.highlight)).toHaveCount(0, { timeout: 5000 });
  });

  await step('O9 a pin whose turns the host must re-fetch: offline copy, scroll restored', async () => {
    await scrollToEnd(page);
    await page.evaluate(() => (window as unknown as { __ppEvict: (k: number) => void }).__ppEvict(40));
    await scrollToEnd(page);
    const before = await scrollTopOf(page);
    await page.locator(ui.cardMain).nth(1).click();
    await expect.poll(() => navState(page, 1), { timeout: 12_000 }).toBe('not-found');
    await expect(page.locator(ui.card).nth(1)).toContainText('reconnect to load it');
    expect(await scrollTopOf(page)).toBe(before);
    await expect(page.locator(ui.card)).toHaveCount(3); // never deleted (R14)
  });

  await step('O10 "All chats" lists threads from the local index', async () => {
    await page.locator('#ai-pinpoint-root [role="tab"]', { hasText: 'All chats' }).click();
    await expect(page.locator('#ai-pinpoint-root .pp-thread')).not.toHaveCount(0);
    await page.locator('#ai-pinpoint-root [role="tab"]', { hasText: 'This chat' }).click();
  });

  await step('O16 hotkey path (pin last) works offline', async () => {
    await sendToTab(sw, 'command:pinLast');
    await expect(page.locator(ui.card)).toHaveCount(4, { timeout: 5000 });
  });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);

  await step('O11 export downloads a file', async () => {
    const [download] = await Promise.all([options.waitForEvent('download'), options.getByRole('button', { name: 'Export all pins' }).click()]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const text = (await import('node:fs')).readFileSync(path!, 'utf8');
    expect(JSON.parse(text).threads.length).toBeGreaterThan(0);
    await step('O12 import the same file: preview, then commit', async () => {
      await options.getByLabel('Choose an export file').setInputFiles(path!);
      await options.getByRole('button', { name: 'Preview' }).click();
      await expect(options.getByRole('table', { name: 'Import preview' })).toBeVisible();
      await options.locator('button.btn-primary').click();
      await expect(options.getByRole('table', { name: 'Import result' })).toBeVisible();
    });
  });

  await step('O13/O14 options load, storage stats render', async () => {
    await options.reload();
    await expect(options.getByRole('meter', { name: 'Storage used' })).toBeVisible();
    const checkbox = options.locator('input[type="checkbox"]').first();
    const was = await checkbox.isChecked();
    await checkbox.click();
    await options.reload();
    await expect(options.locator('input[type="checkbox"]').first()).toBeChecked({ checked: !was });
    await options.locator('input[type="checkbox"]').first().click(); // restore
  });

  await step('O17 stream cut by the disconnect resolves via STREAM_TIMEOUT_MS', async () => {
    await context.setOffline(false);
    const cut = await context.newPage();
    await cut.goto(`${BASE}/claude/chat/0ff1ae01-2222-4333-8444-555555555555?n=6&stream=cut`);
    await context.setOffline(true);
    await expect.poll(() => cut.locator('[data-pinpoint-btn]').count(), { timeout: 15_000 }).toBe(6);
    // No action row ever arrives for a cut reply, so its pin is the floating fallback button.
    await cut.locator('#ai-pinpoint-root [data-pinpoint-btn]').click();
    await expect(cut.locator('[data-pinpoint-btn][aria-pressed="true"]')).toHaveCount(1);
  });

  await step('O18/O19 no console errors, no network from the extension', async () => {
    expect(errors).toEqual([]);
    expect(extensionRequests).toEqual([]);
    expect(foreignRequests).toEqual([]);
  });
  context.off('request', onRequest);
});
