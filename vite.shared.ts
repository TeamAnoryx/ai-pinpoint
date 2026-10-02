/** Settings shared by both Vite builds (D-001). */
import { fileURLToPath } from 'node:url';
import type { UserConfig } from 'vite';

export const root = fileURLToPath(new URL('.', import.meta.url));

export function sharedConfig(mode: string): UserConfig {
  const isDev = mode !== 'production';
  return {
    root,
    publicDir: false,
    define: { __DEV__: JSON.stringify(isDev) },
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@content': fileURLToPath(new URL('./src/content', import.meta.url)),
        '@background': fileURLToPath(new URL('./src/background', import.meta.url)),
      },
    },
    esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
    build: {
      target: 'chrome114',
      outDir: 'dist',
      sourcemap: isDev,
      minify: !isDev,
      modulePreload: { polyfill: false },
      reportCompressedSize: false,
    },
  };
}
