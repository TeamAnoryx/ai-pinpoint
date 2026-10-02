import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from './vite.shared';

export default mergeConfig(
  sharedConfig('test'),
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['tests/unit/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/shared/**', 'src/background/**', 'src/content/core/store-proxy.ts'],
        // Chrome-API glue is covered by E2E (TESTING.md §4), not unit tests.
        exclude: ['src/shared/logger.ts', 'src/background/index.ts', 'src/background/broadcast.ts'],
        thresholds: { lines: 90 },
      },
    },
  }),
);
