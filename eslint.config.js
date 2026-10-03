// ESLint flat config. Rules here encode ARCHITECTURE.md invariants (TECH_STACK.md §6) —
// they are not style preferences.
import { fileURLToPath } from 'node:url';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';
import noHostSelectorsOutsideAdapters from './eslint-rules/no-host-selectors-outside-adapters.js';
import noMagicTimeouts from './eslint-rules/no-magic-timeouts.js';

const aliasResolver = fileURLToPath(new URL('./eslint-rules/alias-resolver.cjs', import.meta.url));

const pinpoint = {
  rules: {
    'no-host-selectors-outside-adapters': noHostSelectorsOutsideAdapters,
    'no-magic-timeouts': noMagicTimeouts,
  },
};

/** Offline (R1), CSP, innerHTML (R5), and clipboard-privacy bans. Applied everywhere. */
const BANNED_SYNTAX = [
  { selector: "CallExpression[callee.name='fetch']", message: 'Network access is forbidden (R1).' },
  {
    selector: "CallExpression[callee.property.name='fetch']",
    message: 'Network access is forbidden (R1).',
  },
  {
    selector: 'Identifier[name=/^(XMLHttpRequest|WebSocket|EventSource)$/]',
    message: 'Network access is forbidden (R1).',
  },
  {
    selector: "MemberExpression[property.name='sendBeacon']",
    message: 'Network access is forbidden (R1).',
  },
  {
    selector: "CallExpression[callee.name='importScripts']",
    message: 'Remote code loading is forbidden (R1).',
  },
  { selector: "CallExpression[callee.name='eval']", message: 'eval is forbidden (CSP).' },
  {
    selector: "NewExpression[callee.name='Function']",
    message: 'new Function is forbidden (CSP).',
  },
  {
    selector:
      'AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]',
    message: 'Build DOM with createElement; never assign innerHTML/outerHTML (R5).',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'Build DOM with createElement; never use insertAdjacentHTML (R5).',
  },
  {
    selector: "MemberExpression[object.property.name='clipboard'][property.name='readText']",
    message: 'Clipboard reads are forbidden (NFR-11).',
  },
];

const adapterImports = [
  '@content/adapters',
  '@content/adapters/*',
  '**/content/adapters/**',
  '**/adapters/*',
];
const overlayImports = ['@content/overlay', '@content/overlay/*', '**/content/overlay/**'];

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-e2e/**', 'test-results/**', 'playwright-report/**', 'release/**', 'coverage/**', 'node_modules/**', 'public/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,cjs,mjs}'],
    plugins: { import: importPlugin, pinpoint },
    settings: {
      'import/resolver': { [aliasResolver]: {} },
      'import/extensions': ['.ts', '.tsx', '.js', '.cjs', '.mjs'],
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
    },
    rules: {
      'no-restricted-syntax': ['error', ...BANNED_SYNTAX],
      '@typescript-eslint/no-explicit-any': 'error',
      'pinpoint/no-magic-timeouts': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'import/no-cycle': ['error', { disableScc: true }],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', exports: 'writable', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Constants are the one place timer values may be written as literals.
    files: ['src/shared/constants.ts'],
    rules: { 'pinpoint/no-magic-timeouts': 'off' },
  },
  {
    // R2: host strings only inside adapters. schema.ts holds host *ids* (storage keys,
    // DATA_MODEL.md §1-§2), not selectors or origins — see D-008.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/content/adapters/**', 'src/shared/schema.ts'],
    rules: { 'pinpoint/no-host-selectors-outside-adapters': 'error' },
  },
  {
    // I1: the service worker knows no hosts and renders no UI.
    files: ['src/background/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...adapterImports, ...overlayImports],
              message: 'Background may not import adapters or overlay (I1).',
            },
          ],
        },
      ],
    },
  },
  {
    // I2: the overlay renders from state; it knows no host DOM.
    files: ['src/content/overlay/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: adapterImports, message: 'Overlay may not import adapters (I2).' }] },
      ],
    },
  },
  {
    // I3: adapters are pure DOM capability providers; they know no storage.
    files: ['src/content/adapters/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@content/core/store-proxy',
                '**/core/store-proxy',
                '@background/*',
                '@background',
                '**/background/**',
              ],
              message: 'Adapters may not import storage or background code (I3).',
            },
          ],
        },
      ],
    },
  },
);
