import { rewriteManifest } from '../../scripts/vite-manifest-plugin';
import { checkManifest } from '../../scripts/verify-manifest';
import { isAllowedUrl, scanSource } from '../../scripts/verify-offline';
import {
  ASSET_BUDGET,
  CONTENT_BUDGET,
  CONTENT_SCRIPT,
  checkSizes,
} from '../../scripts/verify-size';
import sourceManifest from '../../manifest.json';

describe('verify-offline', () => {
  test.each([
    ['fetch', 'const r=fetch(u)'],
    ['fetch', 'window.fetch (u)'],
    ['XMLHttpRequest', 'new XMLHttpRequest'],
    ['WebSocket', 'new WebSocket(u)'],
    ['EventSource', 'new EventSource(u)'],
    ['sendBeacon', 'navigator.sendBeacon(u,d)'],
    ['importScripts', 'importScripts("x.js")'],
    ['new Function', 'new Function("return 1")'],
    ['eval', 'eval("1")'],
  ])('flags %s', (rule, source) => {
    expect(scanSource('a.js', source).map((v) => v.rule)).toContain(rule);
  });

  test('does not flag look-alike identifiers', () => {
    expect(scanSource('a.js', 'prefetch(x); x.evaluate(y); retrieval(z)')).toEqual([]);
  });

  test('flags absolute URLs outside the allowlist', () => {
    const found = scanSource('a.js', 'const u="https://cdn.example.com/lib.js"');
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe('absolute-url');
    expect(scanSource('a.js', 'x="wss://socket.example"')[0]?.rule).toBe('absolute-url');
  });

  test('a bare scheme used for validation is not a URL', () => {
    expect(scanSource('a.js', 'if(!u.startsWith("https://"))throw 1')).toEqual([]);
  });

  test('allows host origins, XML namespaces, and the shortcuts page', () => {
    expect(isAllowedUrl('https://claude.ai/chat/abc')).toBe(true);
    expect(isAllowedUrl('https://chatgpt.com')).toBe(true);
    expect(isAllowedUrl('http://www.w3.org/2000/svg')).toBe(true);
    expect(isAllowedUrl('chrome://extensions/shortcuts')).toBe(true);
    expect(isAllowedUrl('https://claude.ai.evil.example')).toBe(false);
    expect(isAllowedUrl('http://claude.ai')).toBe(false);
  });

  test('reports line and column', () => {
    const [v] = scanSource('a.js', 'ok();\n  fetch(u)');
    expect(v).toMatchObject({ file: 'a.js', line: 2, column: 3, rule: 'fetch' });
  });
});

describe('verify-size', () => {
  test('passes within budget', () => {
    expect(checkSizes([{ file: CONTENT_SCRIPT, bytes: 1000 }]).errors).toEqual([]);
  });

  test('flags an oversized content script, asset, and total', () => {
    const errors = checkSizes([
      { file: CONTENT_SCRIPT, bytes: CONTENT_BUDGET + 1 },
      { file: 'assets/big.js', bytes: ASSET_BUDGET + 1 },
      { file: 'assets/a.js', bytes: ASSET_BUDGET },
      { file: 'assets/b.js', bytes: ASSET_BUDGET },
    ]).errors;
    expect(errors.some((e) => e.startsWith(CONTENT_SCRIPT))).toBe(true);
    expect(errors.some((e) => e.startsWith('assets/big.js'))).toBe(true);
    expect(errors.some((e) => e.startsWith('dist/ total'))).toBe(true);
  });

  test('flags a missing content script', () => {
    expect(checkSizes([]).errors).toEqual([`${CONTENT_SCRIPT} missing`]);
  });
});

describe('verify-manifest', () => {
  const built = rewriteManifest(structuredClone(sourceManifest));
  const exists = (): boolean => true;

  test('the real manifest, as built, is compliant', () => {
    expect(checkManifest(built, '1.0.0', exists)).toEqual([]);
  });

  test.each([
    [
      'tabs permission',
      { permissions: ['storage', 'contextMenus', 'tabs'] },
      /permissions must be exactly/,
    ],
    [
      'optional permission',
      { optional_permissions: ['scripting'] },
      /forbidden permission: scripting/,
    ],
    ['all_urls host', { host_permissions: ['<all_urls>'] }, /forbidden permission: <all_urls>/],
    ['web_accessible_resources', { web_accessible_resources: [] }, /web_accessible_resources/],
    ['content_security_policy', { content_security_policy: {} }, /content_security_policy/],
    ['externally_connectable', { externally_connectable: {} }, /externally_connectable/],
    ['manifest v2', { manifest_version: 2 }, /manifest_version/],
  ])('rejects %s', (_name, patch, message) => {
    const errors = checkManifest({ ...built, ...patch }, '1.0.0', exists);
    expect(errors.some((e) => message.test(e))).toBe(true);
  });

  test('rejects all_frames true and extra content script files', () => {
    const cs = { ...built.content_scripts?.[0], all_frames: true, js: ['a.js', 'b.js'] };
    const errors = checkManifest({ ...built, content_scripts: [cs] }, '1.0.0', exists);
    expect(errors).toContain('content_scripts[0].all_frames must be false');
    expect(errors).toContain('content_scripts[0].js must be a single file');
  });

  test('rejects a version mismatch with package.json', () => {
    expect(checkManifest(built, '2.0.0', exists)[0]).toMatch(/does not match package.json/);
  });

  test('rejects references to files missing from dist', () => {
    const errors = checkManifest(built, '1.0.0', (p) => p !== 'assets/content.js');
    expect(errors).toContain('content_scripts[0].js file missing: assets/content.js');
  });
});

describe('manifest plugin', () => {
  test('rewrites source entries to built paths and leaves everything else intact', () => {
    const out = rewriteManifest(structuredClone(sourceManifest));
    expect(out.background?.service_worker).toBe('assets/background.js');
    expect(out.content_scripts?.[0]?.js).toEqual(['assets/content.js']);
    expect(out['permissions']).toEqual(sourceManifest.permissions);
  });

  test('fails loudly on an unmapped entry', () => {
    expect(() => rewriteManifest({ background: { service_worker: 'src/other.ts' } })).toThrow(
      /no built path/,
    );
  });
});
