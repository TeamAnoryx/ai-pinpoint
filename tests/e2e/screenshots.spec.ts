/**
 * Store screenshots (BUILD_PLAN Phase 9): 1280×800 captures of the synthetic fixture pages,
 * never of real conversations. Runs only via `pnpm store:screenshots` (PP_SCREENSHOTS=1).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dismissTip, expect, openThread, sidebar, test, ui } from './harness';

test.skip(!process.env['PP_SCREENSHOTS'], 'store screenshots: run `pnpm store:screenshots`');

const OUT = join(import.meta.dirname, '..', '..', 'store', 'screenshots');

test('store screenshots', async ({ context, extensionId }) => {
  mkdirSync(OUT, { recursive: true });
  const page = await context.newPage();
  await openThread(page, 'claude', '/chat/5c4ee700-2222-4333-8444-555555555555', '?n=40');
  await dismissTip(page);
  for (const i of [1, 6, 13, 22]) await page.locator('[data-pinpoint-btn]').nth(i).click();
  await sidebar(page);
  await page.locator(ui.cardMain).nth(1).focus();
  await page.keyboard.press('F2');
  await page.keyboard.type('Spec we agreed on');
  await page.keyboard.press('Enter');
  await expect(page.locator('#ai-pinpoint-root .pp-toast')).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: join(OUT, '1-sidebar.png') });

  await page.locator(ui.cardMain).nth(3).click();
  await expect(page.locator(ui.highlight)).toHaveCount(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, '2-jump-and-highlight.png') });

  await page.locator('#ai-pinpoint-root [role="tab"]', { hasText: 'All chats' }).click();
  await page.screenshot({ path: join(OUT, '3-all-chats.png') });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await options.getByRole('meter', { name: 'Storage used' }).waitFor();
  await options.screenshot({ path: join(OUT, '4-options.png') });
});
