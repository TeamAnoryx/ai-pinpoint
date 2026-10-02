# DECISIONS — deviations and clarifications

Append-only. Each entry: id, date, phase, what changed, why. Recorded before the code lands (`CLAUDE.md` R12).

---

## D-001 — Plain Vite instead of `@crxjs/vite-plugin`
**Date:** 2026-10-02 · **Phase:** 0 · **Affects:** `TECH_STACK.md` §1, §8, §9

`@crxjs/vite-plugin` wraps every manifest content script in a loader that `import()`s the real chunk, and auto-adds those chunks to `web_accessible_resources`. That contradicts three hard rules in the same spec: content script must be a single chunk (§8), no `web_accessible_resources` (§3, `verify:manifest`), no dynamic imports in content scripts.

**Decision:** two plain Vite builds.
1. `vite.config.ts` — service worker + popup + options (multi-input, ES modules), plus a local plugin (`scripts/vite-manifest-plugin.ts`) that emits `dist/manifest.json` with source paths rewritten to built paths.
2. `vite.content.config.ts` — content script as a single self-contained IIFE (`assets/content.js`).

**Cost:** no HMR for popup/options. Dev loop is `pnpm dev` (both builds in `--watch`) + reload the extension card.

## D-002 — `pnpm build` runs `verify:manifest`
**Date:** 2026-10-02 · **Phase:** 0 · **Affects:** `TECH_STACK.md` §2

The §2 script snippet runs only `verify:offline` and `verify:size`, but `BUILD_PLAN.md` Phase 0 DoD and `CLAUDE.md` §6 require all three verifiers in `pnpm build`. The build script runs all three.

## D-003 — Settings range constants added to `constants.ts`
**Date:** 2026-10-02 · **Phase:** 0 · **Affects:** `DATA_MODEL.md` §11

`validateSettings` must clamp ranges defined in `UI_SPEC.md` §2/§12 and R8 forbids magic numbers. Added:
`SIDEBAR_WIDTH_DEFAULT = 320`, `SIDEBAR_WIDTH_MIN = 240`, `SIDEBAR_WIDTH_MAX = 520`, `MIN_SNIPPET_CHARS = 60`, `HIGHLIGHT_MS_MIN = 600`, `HIGHLIGHT_MS_MAX = 3000`, plus storage key prefixes (`DATA_MODEL.md` §1) as constants.

## D-004 — `Result<T>` shape
**Date:** 2026-10-02 · **Phase:** 0 · **Affects:** `DATA_MODEL.md` §2, §6

`DATA_MODEL.md` §6 uses `.valueOr(...)` as a pseudo-method. Validators return a plain discriminated union
`{ ok: true; value: T } | { ok: false; error: { path: string; message: string } }`
and a free function `valueOr(result, fallback)` provides the fallback behaviour. Plain objects keep results serialisable and dependency-free.

## D-005 — Logger debug switch guarded for the service worker
**Date:** 2026-10-02 · **Phase:** 0 · **Affects:** `TECH_STACK.md` §9

`localStorage` does not exist in the MV3 service worker. The logger reads `localStorage['pp:debug']` only when `localStorage` is defined; in the worker, dev builds log unconditionally. Production builds compile all logging out via `__DEV__`.

## D-006 — Validator details not fixed by the spec
**Date:** 2026-10-02 · **Phase:** 0 · **Affects:** `DATA_MODEL.md` §2

- `StoreMeta.schema` is typed `number`, not `typeof SCHEMA_VERSION`: `meta` is where a newer build's schema is detected (§9 read-only downgrade), so it must be able to hold a value above the current version.
- Identifiers (`pinId`, `targetHash`, `nativeId`, `threadId`) reject when empty or longer than `MAX_ID_CHARS` instead of being clamped — truncation would silently change identity. Free text (snippet, label, title) is clamped as specified.
- `ThreadSummary.url` must start with `https://`. Imported bundles are untrusted and FR-7 navigates to this URL; rejecting other schemes blocks `javascript:` URLs.
- `validateSettings` fills missing fields from `DEFAULT_SETTINGS` (settings written by an older build may lack newer keys); present-but-wrong-typed fields still reject. `DEFAULT_SETTINGS` lives in `schema.ts` to avoid a `schema ↔ settings` import cycle; `settings.ts` accessors arrive with their first consumer.
- `normaliseForHash` replaces punctuation/symbol runs with a single space (rather than deleting them) so adjacent words never merge.
- Added validator bounds to `constants.ts`: `MAX_ID_CHARS = 256`, `MAX_TITLE_CHARS = 300`, `MAX_URL_CHARS = 2048`, `MAX_VERSION_CHARS = 32`.

## D-007 — RPC contract details
**Date:** 2026-10-02 · **Phase:** 0 · **Affects:** `ARCHITECTURE.md` §8

- Requests carry `protocol: RPC_PROTOCOL` (currently `1`). It is the field the worker checks to return `VERSION_MISMATCH` (e.g. a content script left over from before an extension update).
- `pins:add` payload is `{ hostId, threadId, pin: NewPin, thread: { title, url } }`. `NewPin` = `Pin` minus `order`, `updatedAt`, `repairCount` (worker-assigned). `pinId` and `createdAt` are client-generated so the store-proxy's single retry is idempotent — the worker dedupes by `pinId`. `thread` metadata is needed because the worker knows no hosts (I1) yet must write `ThreadSummary.title/url` into the index.
- `pins:update.patch` is `{ label?: string | null }` — the only user-editable field; order and hash have dedicated messages.
- Parameterless messages carry `payload: null`.
- `ImportReport` = `{ mode, dryRun, threadsAdded, threadsMerged, threadsReplaced, pinsAdded, pinsConflicting, bytesDelta, quota, committed, writtenKeys, error }` covering the dry-run fields of `DATA_MODEL.md` §10 and the partial-import report.

## D-008 — Lint and verifier scoping
**Date:** 2026-10-02 · **Phase:** 0 · **Affects:** `TECH_STACK.md` §6, §7

- `verify:offline` also allowlists XML namespace URIs (`http://www.w3.org/2000/svg`, `/1999/xlink`, `/1999/xhtml`, `/1998/Math/MathML`, `/XML/1998/namespace`). They are identifiers passed to `createElementNS`, never fetched; Preact contains them and SVG built without `innerHTML` (R5) needs them.
- `pinpoint/no-host-selectors-outside-adapters` applies to `src/**` (runtime code). `scripts/` and `tests/` legitimately name the host origins (verifier allowlist, adapter fixtures). `src/shared/schema.ts` is exempt: it defines `HostId` values (`'gemini' | 'chatgpt' | 'claude'`) that `DATA_MODEL.md` §1–§2 use as storage keys — identifiers, not selectors or origins.
- `import/no-cycle` resolves tsconfig aliases through a 30-line local resolver (`eslint-rules/alias-resolver.cjs`) instead of adding `eslint-import-resolver-typescript` (R7). It runs with `disableScc: true`: the SCC pre-pass crashes under flat config with a path-based resolver.
- `@preact/preset-vite` is not used (TECH_STACK §1 lists it as a dev dep). Its value is HMR/prefresh, which D-001 removes; esbuild's automatic JSX runtime with `jsxImportSource: 'preact'` covers compilation. Avoids its `@babel/core` peer.
