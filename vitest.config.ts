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
        include: ['src/shared/**'],
        exclude: ['src/shared/logger.ts'],
        thresholds: { lines: 90 },
      },
    },
  }),
);
