/**
 * Emits dist/manifest.json from the root manifest.json, rewriting source entry paths to the
 * fixed built paths (D-001). Fails the build if a source path has no mapping.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const BUILT_PATHS: Readonly<Record<string, string>> = {
  'src/background/index.ts': 'assets/background.js',
  'src/content/index.ts': 'assets/content.js',
};

interface SourceManifest {
  background?: { service_worker?: string };
  content_scripts?: { js?: string[] }[];
  [key: string]: unknown;
}

function mapPath(source: string): string {
  const built = BUILT_PATHS[source];
  if (!built) throw new Error(`manifest: no built path for ${source}`);
  return built;
}

export function rewriteManifest(source: SourceManifest): SourceManifest {
  const out: SourceManifest = structuredClone(source);
  if (out.background?.service_worker) {
    out.background.service_worker = mapPath(out.background.service_worker);
  }
  for (const script of out.content_scripts ?? []) {
    script.js = (script.js ?? []).map(mapPath);
  }
  return out;
}

export function manifestPlugin(root: string): Plugin {
  const manifestPath = resolve(root, 'manifest.json');
  return {
    name: 'pinpoint-manifest',
    buildStart() {
      this.addWatchFile(manifestPath);
    },
    generateBundle() {
      const source = JSON.parse(readFileSync(manifestPath, 'utf8')) as SourceManifest;
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(rewriteManifest(source), null, 2)}\n`,
      });
    },
  };
}
