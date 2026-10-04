/**
 * Playwright fixtures: a persistent Chromium context with the unpacked E2E build loaded,
 * the extension service worker, and helpers for the overlay (open shadow root in the E2E
 * build only, D-018) and for worker RPC from an extension page.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, test as base, type BrowserContext, type Page, type Request, type Worker } from '@playwright/test';

export const BASE = 'http://localhost:4517';
/** The unpacked extension to load: the E2E build, or `PP_EXT_DIR` (the extracted release zip). */
const DIST = process.env['PP_EXT_DIR'] ?? join(import.meta.dirname, '..', '..', 'dist-e2e');

/** Prefer Playwright's own Chromium; fall back to any installed ms-playwright Chromium. */
function chromiumPath(): string | undefined {
  if (process.env['PW_CHROMIUM']) return process.env['PW_CHROMIUM'];
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    // fall through
  }
  const root = join(process.env['LOCALAPPDATA'] ?? join(process.env['HOME'] ?? '', '.cache'), 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const b of builds) {
    for (const exe of ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, b, exe);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

export interface Fixtures {
  context: BrowserContext;
  sw: Worker;
  extensionId: string;
  /** Requests any page made outside the fixture server (must stay empty — O19). */
  foreignRequests: string[];
  rpc: <T = unknown>(type: string, payload: unknown) => Promise<T>;
}

export const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'pinpoint-e2e-'));
    const executablePath = chromiumPath();
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ...(executablePath ? { executablePath } : {}),
      viewport: { width: 1280, height: 800 },
      args: ['--headless=new', `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  sw: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
  foreignRequests: async ({ context }, use) => {
    const foreign: string[] = [];
    const onRequest = (r: Request): void => {
      const url = r.url();
      if (!url.startsWith(BASE) && !url.startsWith('chrome-extension://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        foreign.push(url);
      }
    };
    context.on('request', onRequest);
    await use(foreign);
    context.off('request', onRequest);
  },
  rpc: async ({ context, extensionId }, use) => {
    let page: Page | null = null;
    let seq = 0;
    await use(async <T>(type: string, payload: unknown): Promise<T> => {
      page ??= await context.newPage();
      if (!page.url().startsWith('chrome-extension://')) {
        await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
      }
      const res = (await page.evaluate(
        (msg) => chrome.runtime.sendMessage(msg),
        { protocol: 1, type, requestId: `e2e-${++seq}`, payload },
      )) as { ok: boolean; data?: T; error?: { code: string } };
      if (!res.ok) throw new Error(`rpc ${type} failed: ${res.error?.code}`);
      return res.data as T;
    });
  },
});

export const expect = test.expect;

/** Locators inside the overlay's (open, E2E-only) shadow root. */
export const ui = {
  handle: '#ai-pinpoint-root .pp-handle',
  sidebar: '#ai-pinpoint-root .pp-sidebar',
  card: '#ai-pinpoint-root .pp-card',
  cardMain: '#ai-pinpoint-root .pp-card-main',
  highlight: '#ai-pinpoint-root [data-pinpoint-ui="highlight"]',
  toastButton: '#ai-pinpoint-root .pp-toast button',
};

export async function openThread(page: Page, host: string, threadPath: string, query = ''): Promise<void> {
  await page.goto(`${BASE}/${host}${threadPath}${query}`);
  await page.waitForSelector('[data-pinpoint-btn]', { state: 'attached', timeout: 15_000 });
}

export async function sidebar(page: Page): Promise<void> {
  if (await page.locator(ui.sidebar).count()) return;
  await page.locator(ui.handle).click();
  await page.locator(ui.sidebar).waitFor();
}

/** Ask the content script directly (as the worker would) — hotkeys cannot be pressed headless. */
export async function sendToTab(sw: Worker, type: string, payload: unknown = null): Promise<void> {
  await sw.evaluate(
    async ({ type, payload }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) await chrome.tabs.sendMessage(tab.id, { protocol: 1, type, requestId: 'e2e', payload });
    },
    { type, payload },
  );
}

/** Dismiss the first-run tip; it follows host layout by design, so pixel checks exclude it. */
export async function dismissTip(page: Page): Promise<void> {
  const gotIt = page.locator('#ai-pinpoint-root .pp-tip button');
  if (await gotIt.count()) await gotIt.click();
  await page.locator('#ai-pinpoint-root .pp-tip').waitFor({ state: 'detached' });
}
