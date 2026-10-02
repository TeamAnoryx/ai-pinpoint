/**
 * Build 2 of 2: the content script as one self-contained IIFE. A single chunk means no
 * dynamic import and therefore no web_accessible_resources (TECH_STACK.md §8, D-001).
 */
import { defineConfig, mergeConfig } from 'vite';
import { sharedConfig } from './vite.shared';

export default defineConfig(({ mode }) =>
  mergeConfig(sharedConfig(mode), {
    build: {
      emptyOutDir: false,
      lib: {
        entry: 'src/content/index.ts',
        formats: ['iife'],
        name: 'AIPinpointContent',
        fileName: () => 'assets/content.js',
      },
      rollupOptions: {
        output: { inlineDynamicImports: true, extend: false },
      },
    },
  }),
);
