/**
 * Smoke test of the packaged release (BUILD_PLAN Phase 9 DoD): the extracted zip loads as an
 * unpacked extension; the worker boots, migrates, and answers RPC; popup and options render
 * with no errors; storage round-trips; nothing reaches the network. Runs only via
 * `pnpm smoke:package`, which sets PP_EXT_DIR. The production build matches no localhost
 * origin, so host-page flows are covered by the E2E build instead.
 */
import { expect, test } from './harness';

test.skip(!process.env['PP_EXT_DIR'], 'packaged-build smoke test: run `pnpm smoke:package`');

test('packaged build: worker, popup, options, storage round trip, no network', async ({ context, extensionId, rpc }) => {
  const network: string[] = [];
  context.on('request', (r) => {
    if (!r.url().startsWith('chrome-extension://')) network.push(r.url());
  });
  const errors: string[] = [];

  // Talking to the worker over RPC proves it booted; read the manifest it was loaded with.
  const settings = await rpc<{ theme: string }>('settings:get', null);
  const manifestPage = await context.newPage();
  await manifestPage.goto(`chrome-extension://${extensionId}/manifest.json`);
  const manifest = JSON.parse((await manifestPage.locator('body').textContent()) ?? '{}') as chrome.runtime.Manifest;
  await manifestPage.close();
  expect(manifest.permissions).toEqual(['storage', 'contextMenus']);
  expect(JSON.stringify(manifest)).not.toContain('localhost');

  expect(settings.theme).toBeTruthy();
  await rpc('settings:set', { theme: 'dark' });
  expect((await rpc<{ theme: string }>('settings:get', null)).theme).toBe('dark');
  const bundle = await rpc<{ threads: unknown[] }>('transfer:export', null);
  expect(bundle.threads).toEqual([]);

  for (const path of ['src/popup/index.html', 'src/options/index.html']) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${path}: ${m.text()}`);
    });
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    await expect(page.locator('body')).not.toBeEmpty();
  }
  const options = context.pages().find((p) => p.url().endsWith('options/index.html'))!;
  await expect(options.getByRole('button', { name: 'Export all pins' })).toBeVisible();
  await expect(options.getByRole('meter', { name: 'Storage used' })).toBeVisible();

  expect(errors).toEqual([]);
  expect(network).toEqual([]);
});
