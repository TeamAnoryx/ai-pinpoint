/**
 * Page helpers shared by the Phase 8 E2E specs (fixture pages only).
 */
import type { Page } from '@playwright/test';
import { ui } from './harness';

/** Scroll the virtualised container to a fraction of its height and pin the most central message. */
export async function pinAt(page: Page, fraction: number): Promise<void> {
  await page.evaluate((f) => {
    const s = document.querySelector<HTMLElement>('[data-e2e-scroll]')!;
    s.scrollTop = f * (s.scrollHeight - s.clientHeight);
  }, fraction);
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-e2e-scroll]')!.getBoundingClientRect();
    const mid = s.top + s.height / 2;
    let best: Element | null = null;
    let bestD = Infinity;
    for (const b of document.querySelectorAll('[data-pinpoint-btn]:not([aria-pressed="true"])')) {
      const r = b.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (r.height > 0 && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    best?.setAttribute('data-e2e-pick', '');
  });
  const pick = page.locator('[data-e2e-pick]');
  await pick.click();
  await page.waitForFunction(() => document.querySelector('[data-e2e-pick]')?.getAttribute('aria-pressed') === 'true');
  await pick.evaluate((el) => el.removeAttribute('data-e2e-pick'));
}

export function scrollTopOf(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector<HTMLElement>('[data-e2e-scroll]')!.scrollTop);
}

export async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-e2e-scroll]')!;
    s.scrollTop = s.scrollHeight;
  });
  await page.waitForTimeout(250);
}

/** Primary text of each pin card, in list order. */
export function cardTexts(page: Page): Promise<string[]> {
  return page.locator(`${ui.card} .pp-primary`).allTextContents();
}

export function navState(page: Page, index = 0): Promise<string | null> {
  return page.locator(ui.card).nth(index).getAttribute('data-nav');
}
