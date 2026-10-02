/**
 * Minimal eslint-plugin-import resolver (interface v2) for the tsconfig path aliases, so
 * import/no-cycle can follow `@shared/*` etc. without adding a resolver dependency (R7).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ALIASES = {
  '@shared/': 'src/shared/',
  '@content/': 'src/content/',
  '@background/': 'src/background/',
};
const EXTENSIONS = ['.ts', '.tsx', '.js', '.cjs', '.mjs'];

function tryFile(base) {
  const candidates = [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => path.join(base, `index${e}`)),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

exports.interfaceVersion = 2;

exports.resolve = function resolve(source, file) {
  if (source.startsWith('node:')) return { found: true, path: null };
  const alias = Object.keys(ALIASES).find((a) => source.startsWith(a));
  if (alias) {
    const target = tryFile(path.join(ROOT, ALIASES[alias], source.slice(alias.length)));
    return target ? { found: true, path: target } : { found: false };
  }
  if (source.startsWith('.')) {
    const target = tryFile(path.resolve(path.dirname(file), source));
    return target ? { found: true, path: target } : { found: false };
  }
  // Bare package specifiers: treat as external (not part of cycle analysis).
  return { found: true, path: null };
};
