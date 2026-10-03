/**
 * E2E against the unpacked E2E build (`dist-e2e`, D-018) on the local fixture server.
 * Extensions need a persistent context, so tests launch it via tests/e2e/harness.ts.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  webServer: {
    command: 'tsx tests/e2e/server.ts',
    url: 'http://localhost:4517/blank',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
