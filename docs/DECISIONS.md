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

## D-009 — Phase 1 storage contract additions
**Date:** 2026-10-02 · **Phase:** 1 · **Affects:** `DATA_MODEL.md` §2, §5, §8, §10, §11; `ARCHITECTURE.md` §8

- `ThreadRecord.url: string` (https only). The host index is a cache that `rebuildIndex` regenerates from thread records (§6); without the URL on the record, rebuild could not restore `ThreadSummary.url`, and the worker cannot reconstruct host URLs itself (I1). Schema v1 has not shipped, so no migration.
- `StorageStats` gains `quarantined: string[]`, `level: 'ok' | 'warn' | 'block'`, and `readOnly: boolean`, so the UI can show the quarantine banner (EDGE_CASES §18), the 80% warning (FR-12), and the read-only banner (§9) from one call.
- Quarantine moves the raw value to `pp:v1:quarantine:<originalKey>` and removes the original key in one `storage.set` + `remove` pair. The data is preserved, never deleted (R14); reads then see an empty thread.
- `pins:remove` of an unknown `pinId` succeeds (`{ removed: true }`) — idempotent so the store-proxy retry is safe (EDGE_CASES §9). `pins:update`/`pins:repairHash` of an unknown pin return `NOT_FOUND`.
- `pins:add` with an existing `pinId` returns the stored pin unchanged (idempotent retry).
- `pins:update` trims the label; an empty label becomes `null`.
- `pins:reorder` accepts a full or partial `orderedIds`: unknown ids are ignored and pins missing from the list keep their relative order after the listed ones, so a reorder racing a concurrent add never drops a pin.
- Reorder keeps the longest run of pins whose existing `order` is already increasing and only renumbers the moved pins into the gaps; when a gap has no free integer, the whole thread is renormalised to multiples of `ORDER_STEP` in the same single write.
- Import: `merge` keeps current settings; `replace` also replaces settings. Writes run in batches of `IMPORT_BATCH_SIZE` keys, each batch under the locks of the threads it touches.
- New constants: `ORDER_STEP = 100`, `IMPORT_BATCH_SIZE = 20`, `RPC_TIMEOUT_MS = 5000`, `RPC_MAX_RETRIES = 1`, `STORAGE_QUOTA_BYTES_FALLBACK = 10_485_760`, `QUARANTINE_KEY_PREFIX`.

## D-010 — Phase 2 adapter helpers and constants
**Date:** 2026-10-02 · **Phase:** 2 · **Affects:** `ADAPTERS.md` §1, §2, §6; `DATA_MODEL.md` §11; `EDGE_CASES.md` §1, §11, §12

- New constants: `SCROLLABLE_SLACK_PX = 40` (an ancestor counts as scrollable only if it overflows by more than this), `DEEP_QUERY_MAX_DEPTH = 6` and `DEEP_QUERY_NODE_BUDGET = 5000` (bounds on open-shadow-root traversal), `BUTTON_ROW_MIN_BUTTONS = 2`, `BUTTON_ROW_MAX_TEXT_CHARS = 12` (a row may carry a branch counter such as "2 / 3"), `GENERIC_MIN_MESSAGE_CHARS = 40`, `GENERIC_MIN_REPEATS = 3` (values from ADAPTERS §6), `OLDER_MESSAGES_SCROLL_RATIO = 0.9`, `OLDER_MESSAGES_WAIT_MS = 600`.
- `extractText` reads text with a layout-independent walker (text nodes plus newlines at block elements) instead of `innerText`. `innerText` depends on CSS visibility and layout, which changes with hover state and off-screen virtualisation; a hash must not.
- `createStreamSampler` is the shared fallback for `isElementStreaming`: the first sighting reports streaming; a node is finished once two samples at least `STREAM_SAMPLE_MS` apart see the same text length; after `STREAM_TIMEOUT_MS` from first sighting it is finished regardless (EDGE_CASES §1). Callers must re-check deferred nodes on the next batch.
- Selector sets are declared as ordered `TierEntry { tier: 1|2|3|4, find: string | (root) => Element[] }` lists; the set records which tier resolved each key so the health module can flag tier-4-only resolution as drift (ADAPTERS §1).
- Registry: when the matched adapter's probe finds no message nodes and no action-bar mounts, `resolve` returns a wrapper that keeps the host adapter's `id`, `getThreadId` and `getThreadTitle` but takes DOM queries from the generic adapter (ADAPTERS §6 fallback), so pins stay keyed to the real host.

## D-011 — Live host DOM survey (2026-10-02) — adapter targets
**Phase:** 2 · **Affects:** `ADAPTERS.md` §3–§5. Structure and attributes only; no message text was read.

- **Gemini:**
  - Turns and ids:
    - A turn is a `div.conversation-container` whose `id` is a stable 16-hex turn id. The inner `message-content#message-content-id-r_<hex>` embeds it.
    - Message nodes are the `user-query` and `model-response` custom elements (tier 2: component tag names).
    - Native id = turn hex + role. `[id^=user-query-content-N]` is an ordinal, not an id; do not use it.
  - Text:
    - Model text comes only from the `message-content` element. Thoughts, sources, disclaimers and the `h6` screen-reader label all sit outside it.
    - User text comes from the `p` lines in the query bubble. An `h5` screen-reader label precedes them.
  - Action rows and code blocks:
    - Model action row: `message-actions` → `[class*=buttons-container]`.
    - User action row: `.luminous-actions-container` (Copy prompt + Edit).
    - Code blocks are a `code-block` element with its own buttons; ignore them when finding the row.
  - Page structure and title:
    - Scroll container: `infinite-scroller[data-test-id=chat-history-container]`.
    - Root: the `chat-window` element. It is a tag, so `[class*=chat-window]` misses it.
    - Neither `[role=main]` nor `[aria-selected]` exists in the history rail.
    - Title: `document.title` minus the " - Google Gemini" suffix.
- **ChatGPT:**
  - A turn is `section[data-testid^=conversation-turn][data-turn=user|assistant][data-turn-id]`.
  - A message is `[data-message-author-role][data-message-id]` (a UUID).
  - There are no `article` elements.
  - Action row: `[role=group]` in the turn wrapper, containing `[data-testid=copy-turn-action-button]`.
  - The `h4.sr-only` label sits outside the message node.
  - Scroll container: the `overflow-y:auto` div above `main#main`. `#thread` holds the turns.
  - Title: `document.title`.
- **Claude:**
  - The transcript is virtualised:
    - `[data-testid=transcript-list]` > `[data-testid=transcript-sizer]` > `[data-testid=transcript-row][data-index]`, plus `transcript-spacer` elements.
    - Each row has one `[role=article]`, which is one message.
    - User body: `[data-testid=user-message]`.
    - Assistant: `[data-testid=assistant-message][data-is-streaming=true|false]`.
  - **Native ids exist** (deviation from §5):
    - `[data-turn-key]` holds the message UUID on user turns and `<uuid>-hub-reply` on assistant turns.
    - Verified stable across a reload, so Claude is no longer hash-primary.
  - Action rows:
    - Assistant: `[data-testid=message-actions]`. It renders deferred and may hold only one button until hydrated.
    - User: a sibling deferred div.
  - Exclude from text:
    - `[data-find-omitted]` (screen-reader headings and the status region).
    - `[data-sheet-kind]` (artifact and file cards with `[data-testid=file-card-open]`).
  - Gone from the DOM: the `font-claude` classes and `data-test-render-count`.
  - Scroll container: `[data-autoscroll-container]`.
  - Title: `document.title` minus " - Claude".
  - Thinking-block markup is not yet confirmed because the survey was cut short. Exclude `[aria-expanded]` disclosure regions that precede the reply text, and synthesise the fixture.

## D-012 — Phase 2 adapter implementation choices
**Date:** 2026-10-03 · **Phase:** 2 · **Affects:** `ADAPTERS.md` §3–§7, §9; `TESTING.md` §3

- **Gemini observer root** is the `infinite-scroller[data-test-id=chat-history-container]` first, then `chat-window`, `[role=main]`, `main`. The scroller holds every turn but not the composer, so keystrokes never trigger a reconcile (ADAPTERS §3 quirk). `requestOlderMessages` uses the same scroll-up-and-wait as ChatGPT/Claude: the scroller lazy-loads older turns at the top.
- **Native ids:** Gemini = `<turn hex id>:<role>` (one turn holds both messages); ChatGPT = `data-message-id`; Claude = `data-turn-key` (D-011).
- **Streaming:** a definitive host marker wins — ChatGPT stop button (streaming) / send button (idle), Claude `data-is-streaming`, any `aria-busy="true"`. Without one, only the last assistant node is sampled with `createStreamSampler`; sampling every node would defer the whole thread by `STREAM_SAMPLE_MS` on boot.
- **Claude user turns** return `null` from `getActionBarMount` when no button row exists, which selects the floating path (ADAPTERS §8) rather than returning a `floating` mount point.
- **Claude reasoning exclusion:** for each `[aria-expanded]` toggle inside the assistant body, the top-level block of the body that contains it is dropped before text extraction.
- **Registry fallback** to generic only happens when the generic adapter itself finds message nodes. A legitimately empty new chat keeps the real adapter instead of being downgraded.
- **Generic thread ids** are `generic:<segment>`, matching the `<host>:<id>` form of DATA_MODEL §3.
- **Fixtures** are synthetic: `tests/support/fixtures/synth.ts` reproduces the D-011 structure with placeholder words and writes `tests/fixtures/<host>/*.html` via `pnpm fixture:capture --synth`. A test asserts the committed files match the generator. `fixture:capture --scrub` turns a real devtools capture into a fixture by replacing all text and content attributes.
- `scripts/jsdom.d.ts` declares the small jsdom surface the scripts use instead of adding `@types/jsdom`.

## D-013 — Phase 3 identity, observer, and thread watcher
**Date:** 2026-10-03 · **Phase:** 3 · **Affects:** `DATA_MODEL.md` §3–§4, §11; `ARCHITECTURE.md` §5, §10–§11; `EDGE_CASES.md` §1, §4

- Each node is indexed under its primary hash (`n:` when it has a native id) **and** its content hash, so a pin whose stored hash is a content hash (e.g. imported from another session) still matches exactly on id-first hosts (ADAPTERS §4 "secondary key").
- `identity.rebuildIndex(nodes, pending)`: streaming nodes keep their ordinal slot but are neither hashed nor cached. Text, role, native id and content base are cached per node in a `WeakMap`; only the ordinal-dependent hash is recomputed each tick.
- Similarity scan walks candidates outward from the pin's ordinal (closest first), skips role mismatches, compares the pin snippet with the same-length prefix of each node's normalised text, and stops at the first score ≥ `SIMILARITY_EARLY_EXIT` (0.98, DATA_MODEL §4).
- Observer adds `MUTATION_MAX_WAIT_MS = 1000`: a pure trailing debounce never fires under a constant mutation storm, so a pending batch runs at least that often. Scope lookups in the mutation filter are memoised per batch (a streaming burst targets one node).
- Observer watches `childList` + `subtree` only. Stream completion is caught by the action row appearing (a childList change) or by the engine's re-check timer for deferred nodes; observing attributes would require host attribute names outside adapters (R2).
- `ADAPTER_FAILURE_LIMIT = 3` failures within `ADAPTER_FAILURE_WINDOW_MS = 60_000` stop the observer and report fatal (ARCHITECTURE §10 `disabled:adapter-error`).
- Thread watcher reports `fromTransient`; the engine decides promotion by checking whether the previously indexed message nodes are still connected (same conversation gaining an id) rather than a navigation to another thread.
- New constants: `HASH_HEAD_CHARS`, `HASH_TAIL_CHARS`, `ORDINAL_BUCKET`, `SIMILARITY_EARLY_EXIT`, `BRANCH_DRIFT_RATIO = 0.2` (EDGE_CASES §6), `HREF_TICK_MS = 400`, `MUTATION_MAX_WAIT_MS`, `ADAPTER_FAILURE_*`, `OBSERVER_ROOT_TIMEOUT_MS = 15_000`, `OBSERVER_ROOT_POLL_MS = 250` (ARCHITECTURE §4), `IDLE_FALLBACK_MS`.
