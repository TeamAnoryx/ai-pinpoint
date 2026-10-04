/** Manifest hard constraints (TECH_STACK.md §3, CLAUDE.md R13). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_PERMISSIONS, FORBIDDEN_PERMISSIONS, HOST_PATTERNS } from './allowlist';
import { isMain } from './cli';

type Json = Record<string, unknown>;

const FORBIDDEN_KEYS = [
  'externally_connectable',
  'web_accessible_resources',
  'content_security_policy',
];

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function object(v: unknown): Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Returns a list of violations; empty means the manifest is compliant. */
export function checkManifest(
  m: Json,
  packageVersion: string,
  fileExists: (path: string) => boolean,
): string[] {
  const errors: string[] = [];
  const requireFile = (label: string, path: unknown): void => {
    if (typeof path !== 'string' || !fileExists(path)) {
      errors.push(`${label} file missing: ${String(path)}`);
    }
  };

  if (m['manifest_version'] !== 3) errors.push('manifest_version must be 3');
  if (m['version'] !== packageVersion) {
    errors.push(`version ${String(m['version'])} does not match package.json ${packageVersion}`);
  }

  const permissions = strings(m['permissions']);
  if (!sameSet(permissions, ALLOWED_PERMISSIONS)) {
    errors.push(
      `permissions must be exactly ${ALLOWED_PERMISSIONS.join(', ')}; got ${permissions.join(', ')}`,
    );
  }
  const optional = strings(m['optional_permissions']);
  const requested = [...permissions, ...optional, ...strings(m['host_permissions'])];
  for (const p of FORBIDDEN_PERMISSIONS) {
    if (requested.includes(p)) errors.push(`forbidden permission: ${p}`);
  }
  if (optional.length > 0) errors.push('optional_permissions must be empty');

  for (const key of FORBIDDEN_KEYS) {
    if (key in m) errors.push(`forbidden manifest key: ${key}`);
  }

  if (!sameSet(strings(m['host_permissions']), HOST_PATTERNS)) {
    errors.push(`host_permissions must be exactly ${HOST_PATTERNS.join(', ')}`);
  }

  const scripts = Array.isArray(m['content_scripts']) ? m['content_scripts'].map(object) : [];
  if (scripts.length === 0) errors.push('content_scripts missing');
  for (const [i, cs] of scripts.entries()) {
    if (cs['all_frames'] !== false) errors.push(`content_scripts[${i}].all_frames must be false`);
    if (!sameSet(strings(cs['matches']), HOST_PATTERNS)) {
      errors.push(`content_scripts[${i}].matches must be exactly the four host patterns`);
    }
    const js = strings(cs['js']);
    if (js.length !== 1) errors.push(`content_scripts[${i}].js must be a single file`);
    js.forEach((f) => requireFile(`content_scripts[${i}].js`, f));
  }

  requireFile('background.service_worker', object(m['background'])['service_worker']);
  requireFile('action.default_popup', object(m['action'])['default_popup']);
  requireFile('options_page', m['options_page']);
  for (const [size, path] of Object.entries(object(m['icons']))) requireFile(`icons.${size}`, path);

  return errors;
}

if (isMain(import.meta.url)) {
  const manifestPath = join('dist', 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error('verify:manifest — dist/manifest.json not found; run the build first');
    process.exit(1);
  }
  const manifest = object(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const pkg = object(JSON.parse(readFileSync('package.json', 'utf8')));
  const errors = checkManifest(manifest, String(pkg['version']), (p) =>
    existsSync(join('dist', p)),
  );
  if (errors.length > 0) {
    console.error(`verify:manifest — ${errors.length} violation(s):\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  console.log('verify:manifest — OK');
}
