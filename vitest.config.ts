import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from './vite.shared';

export default mergeConfig(
  sharedConfig('test'),
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      // Coverage instrumentation slows jsdom fixture tests several-fold.
      testTimeout: 20_000,
      setupFiles: ['tests/support/dom-polyfills.ts'],
      include: ['tests/unit/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/shared/**', 'src/background/**', 'src/content/core/**', 'src/content/adapters/**'],
        // Chrome-API glue is covered by E2E (TESTING.md §4), not unit tests.
        exclude: ['src/shared/logger.ts', 'src/background/index.ts', 'src/background/broadcast.ts'],
        thresholds: { lines: 90 },
      },
    },
  }),
);
