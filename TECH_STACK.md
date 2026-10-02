# TECH STACK — tooling, dependencies, configuration

Decisions are fixed. Agents implement against them and do not substitute alternatives without an explicit instruction from the user.

---

## 1. Decisions

| Concern | Choice | Why |
|---|---|---|
| Manifest | **MV3** | required by Chrome Web Store |
| Language | **TypeScript 5.x**, `strict: true` | the RPC and schema contracts are the backbone; untyped boundaries are the main defect source |
| Bundler | **Vite 5** + `@crxjs/vite-plugin` | MV3-aware, HMR for popup/options, fast content-script builds |
| UI runtime | **Preact 10** + `preact/hooks` | ~4 KB vs React's ~45 KB; NFR-4 bundle budget. JSX via `preact` automatic runtime |
| Styling | **plain CSS** imported as a string, injected via `adoptedStyleSheets` | no CSS-in-JS runtime, no build-time extraction complexity, works in Shadow DOM |
| State (overlay) | **Preact signals** (`@preact/signals`) | fine-grained updates, no reducer boilerplate, 1.5 KB |
| Validation | **hand-written validators** (no zod) | zod is ~12 KB; we validate ~6 shapes. See `DATA_MODEL.md` §2 |
| Hashing | **hand-written FNV-1a 32** | no dependency, deterministic, fast |
| Unit tests | **Vitest** + **jsdom** | same transform pipeline as Vite |
| E2E | **Playwright** with `--load-extension` against local fixture pages | real Chrome, real extension APIs, no network |
| Lint | **ESLint 9** flat config + `@typescript-eslint` | plus custom rules in §6 |
| Format | **Prettier 3** | 2-space, single quotes, 100 cols, trailing commas |
| Package manager | **pnpm** | lockfile determinism |
| Node | **≥ 20.11** | Vite 5 requirement |

## 2. Scripts (`package.json`)

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build && pnpm run verify:offline && pnpm run verify:size",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "adapter:probe": "tsx scripts/adapter-probe.ts",
    "fixture:capture": "tsx scripts/fixture-capture.ts",
    "verify:offline": "tsx scripts/verify-offline.ts",
    "verify:size": "tsx scripts/verify-size.ts",
    "verify:manifest": "tsx scripts/verify-manifest.ts",
    "package": "pnpm run build && tsx scripts/zip.ts"
  }
}
```

`pnpm build` must fail if the offline, size, or manifest verifier fails. No exceptions.

## 3. `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "AI Pinpoint",
  "version": "1.0.0",
  "description": "Pin and jump to any message in Gemini, ChatGPT, and Claude conversations. Works fully offline.",
  "minimum_chrome_version": "114",
  "permissions": ["storage", "contextMenus"],
  "optional_permissions": [],
  "host_permissions": [
    "https://gemini.google.com/*",
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*"
  ],
  "background": { "service_worker": "src/background/index.ts", "type": "module" },
  "content_scripts": [
    {
      "matches": [
        "https://gemini.google.com/*",
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://claude.ai/*"
      ],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "action": { "default_popup": "src/popup/index.html", "default_title": "AI Pinpoint" },
  "options_page": "src/options/index.html",
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
  "commands": {
    "pin-last": {
      "suggested_key": { "default": "Alt+Shift+P" },
      "description": "Pin the last assistant message"
    },
    "toggle-sidebar": {
      "suggested_key": { "default": "Alt+Shift+S" },
      "description": "Toggle the AI Pinpoint sidebar"
    },
    "focus-filter": {
      "suggested_key": { "default": "Alt+Shift+F" },
      "description": "Search pinned messages"
    }
  }
}
```

Hard constraints enforced by `verify:manifest`:
- `permissions` contains **only** `storage` and `contextMenus`. No `tabs`, `activeTab`, `scripting`, `webRequest`, `unlimitedStorage`, `clipboardRead`, `<all_urls>`.
- No `externally_connectable`.
- No `web_accessible_resources` (add only with a documented justification).
- No `content_security_policy` key at all (defaults are the strictest; relaxing it is forbidden).
- `all_frames` is `false`.
- Every `host_permissions` entry is https and exactly one of the four known origins.

## 4. Dependency allowlist

**Runtime dependencies — complete list. Nothing else may be added without explicit user approval.**

```
preact                ^10
@preact/signals       ^2
```

That is the entire runtime surface. Rationale: every added dependency is a potential network-capable or remote-code vector, and `PRD.md` §6 makes offline a correctness property.

**Dev dependencies (allowed):** typescript, vite, @crxjs/vite-plugin, @preact/preset-vite, vitest, jsdom, @playwright/test, eslint, @typescript-eslint/*, eslint-plugin-import, prettier, tsx, @types/chrome, archiver (for `zip.ts`).

**Categorically rejected:** any HTTP client (axios, ky, got), any analytics or error-reporting SDK (sentry, posthog, amplitude, ga), any font package that fetches at runtime, any icon package that loads remote sprites, any date library (write a 20-line relative-time formatter), any CSS framework (tailwind's runtime CDN build especially), any state library larger than signals, any ML/embedding library, any `eval`-based templating.

Review gate: a PR adding a `dependencies` entry must state why the functionality cannot be hand-written in < 100 lines, and must prove the package issues no network calls.

## 5. `tsconfig.json` essentials

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["chrome", "vitest/globals"],
    "paths": {
      "@shared/*":   ["./src/shared/*"],
      "@content/*":  ["./src/content/*"],
      "@background/*": ["./src/background/*"]
    }
  },
  "include": ["src", "tests", "scripts"]
}
```

`noUncheckedIndexedAccess` matters here: DOM queries return possibly-undefined entries and the adapters are full of index access.

## 6. Lint rules that encode architecture

Custom ESLint configuration — these are not style preferences, they enforce `ARCHITECTURE.md` invariants.

| Rule | Enforcement |
|---|---|
| `no-restricted-imports` | `src/background/**` may not import from `src/content/adapters/**` or `src/content/overlay/**` (I1) |
| `no-restricted-imports` | `src/content/overlay/**` may not import from `src/content/adapters/**` (I2) |
| `no-restricted-imports` | `src/content/adapters/**` may not import from `src/content/core/store-proxy` or `src/background/**` (I3) |
| `no-restricted-syntax` | `fetch(`, `new XMLHttpRequest`, `new WebSocket`, `new EventSource`, `navigator.sendBeacon`, `importScripts`, `eval`, `new Function` — error everywhere (offline + CSP) |
| `no-restricted-syntax` | `.innerHTML =`, `.outerHTML =`, `insertAdjacentHTML` — error everywhere (§Security) |
| `no-restricted-syntax` | `navigator.clipboard.readText` — error (privacy) |
| custom `no-host-selectors-outside-adapters` | literal strings matching `/gemini|chatgpt|openai|claude\.ai/i` or `/\[(data-message-id|data-testid)/` outside `src/content/adapters/**` → error |
| custom `no-magic-timeouts` | numeric literals ≥ 100 passed to `setTimeout`/`setInterval` outside `src/shared/constants.ts` → error |
| `@typescript-eslint/no-explicit-any` | error (the RPC boundary must stay typed) |
| `@typescript-eslint/no-floating-promises` | error (dropped promises in observers silently kill reconciles) |
| `import/no-cycle` | error |

## 7. Verifier scripts

**`scripts/verify-offline.ts`** — reads every built JS chunk in `dist/`, greps for the banned identifiers listed in §6, and greps for absolute `http://`/`https://` string literals (allowlist: the four host origins in the manifest, and `chrome://extensions/shortcuts` as display-only text). Any hit → exit 1 with the file, line, and match.

**`scripts/verify-size.ts`** — asserts: content script chunk ≤ 120 KB minified, total `dist/` ≤ 500 KB, no single asset > 150 KB. Prints a table; exit 1 on breach.

**`scripts/verify-manifest.ts`** — asserts every constraint listed in §3 against the built manifest.

**`scripts/adapter-probe.ts`** — loads a fixture HTML into jsdom, instantiates the named adapter, prints the `AdapterProbeResult` plus which selector tier resolved each key. The primary tool for the host-repair runbook (`ADAPTERS.md` §10).

**`scripts/fixture-capture.ts`** — takes a saved `outerHTML` dump, strips text content to lorem while preserving structure/attributes, and writes a fixture. Used to avoid committing real conversation content.

## 8. Build output

```
dist/
├── manifest.json
├── service-worker-loader.js
├── assets/
│   ├── content.<hash>.js      # single chunk, no dynamic imports
│   ├── background.<hash>.js
│   ├── popup.<hash>.js
│   └── options.<hash>.js
├── src/popup/index.html
├── src/options/index.html
└── icons/{16,32,48,128}.png
```

Build config requirements:
- **Content script must be a single chunk.** Dynamic `import()` in a content script requires `web_accessible_resources`, which we forbid. Set `build.rollupOptions.output.inlineDynamicImports` for the content entry, or avoid dynamic imports entirely (preferred).
- `build.target: 'chrome114'`.
- No source maps in the packaged build (`build.sourcemap: false` for `package`; `true` for `dev`).
- `define: { __DEV__: mode !== 'production' }` so `logger` calls are tree-shaken out of production.

## 9. Local development

```
pnpm i
pnpm dev                       # builds to dist/ and watches
# chrome://extensions → Developer mode → Load unpacked → select dist/
```

- Content-script changes require clicking the reload icon on the extension card **and** reloading the host tab.
- Service-worker changes: click "service worker" link to inspect; it reloads automatically on rebuild.
- For adapter work, prefer the fixture pages (`pnpm test:e2e` serves `tests/fixtures/**` over `localhost`) so iteration does not depend on a live host or the network.
- Debug logging: `logger` reads a `localStorage['pp:debug']` flag in dev builds; it is compiled out of production.

## 10. Release

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`
2. Bump `version` in `manifest.json` and `package.json` (keep in sync; `verify:manifest` checks).
3. `pnpm package` → `release/ai-pinpoint-<version>.zip`
4. Verify the zip contains no source maps, no `.map`, no `tests/`, no `docs/`.
5. Web Store listing must state: no account, no data collection, fully offline. Privacy practices form: "does not collect user data" — accurate, and `verify:offline` is the evidence.
