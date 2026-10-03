/** Build 1 of 2: service worker, popup, options, manifest (D-001). */
import { defineConfig, mergeConfig } from 'vite';
import { manifestPlugin } from './scripts/vite-manifest-plugin';
import { root, sharedConfig } from './vite.shared';

export default defineConfig(({ mode }) =>
  mergeConfig(sharedConfig(mode), {
    publicDir: 'public',
    plugins: [manifestPlugin(root, mode)],
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: 'src/background/index.ts',
          popup: 'src/popup/index.html',
          options: 'src/options/index.html',
        },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  }),
);
