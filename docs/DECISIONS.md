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

## D-014 — Phase 4 injection, navigation, engine, health
**Date:** 2026-10-03 · **Phase:** 4 · **Affects:** `ARCHITECTURE.md` §4–§5, §7, §10; `UI_SPEC.md` §5–§6; `EDGE_CASES.md` §1–§2, §6; `ADAPTERS.md` §2

- **`deepQueryAll` searches open shadow roots only when the light DOM has no match**, and discovers shadow roots once per synchronous task. Walking the whole document on every query made per-node adapter calls O(n²). Adapters also memoise the node list and composer state per task (`perTask`) for `isStreaming`.
- **Engine state** is a small observable (`core/state.ts`); the overlay subscribes and calls `engine.intents.*` (I2). The engine receives the overlay's `layer` element (fixed, `pointer-events:none`, inside the closed shadow root) for the highlight ring and floating pin buttons.
- **Reconcile slices** always index at least one node, so a slow listing can never starve progress; remaining unindexed nodes continue in an idle callback. Deferred streaming nodes carry `data-pinpoint-streaming` (used by the mutation filter) and trigger a re-check after `STREAM_RECHECK_MS`.
- **Busy pin button** is a dimmed button with a progress cursor. A rotating ring needs keyframes, which would need a stylesheet in the host document.
- **Undo** re-adds the removed pin with the same `pinId` and label, then sends `pins:reorder` with the pre-removal order. The relative order is restored exactly; the sparse `order` integers may differ.
- **Transient promotion:** on a thread change whose previous scope was `transient:` and whose indexed message nodes are still connected (the same conversation gained an id), each in-memory pin is written with `pins:add` in order. The RPC contract has no batch add. A failure stops promotion and shows a toast; pins already written stay written.
- **NOT_FOUND reasons:** `not-loaded` when sweeping up hit the top, `requestOlderMessages` loaded nothing, and the pin's ordinal is before the rendered window (EDGE_CASES §21 copy). `branch` when the pin's ordinal is beyond the live thread (EDGE_CASES §6). `no-scroll-container`. Otherwise `exhausted`. The extension never checks connectivity itself.
- **Navigation abort restores scroll** only when the user aborted. A navigation superseded by a newer one, or by a teardown, leaves the scroll position to its successor.
- **Pinned-button state** uses identity steps 1–4 only (no similarity scan) on every reconcile. Fuzzy matching runs only on explicit navigation.
- New constants: `HIGHLIGHT_FADE_IN_MS`, `HIGHLIGHT_FADE_OUT_MS`, `HIGHLIGHT_OUTSET_PX`, `HIGHLIGHT_SCROLL_CANCEL_PX = 200`, `FLOATING_BUTTON_PX`, `FLOATING_INSET_PX`, `RECOVERY_STEP_RATIO = 0.8`, `RECOVERY_STEP_WAIT_MS = 150`, `RECOVERY_MAX_STEPS = 24` (EDGE_CASES §2), `SCROLL_SETTLE_FRAMES = 2`, `STREAM_RECHECK_MS`, `UNDO_MS = 5000`, `TOAST_MS = 3000`, `TOAST_ACTION_MS = 5000` (UI_SPEC §10), `FIRST_RUN_TOOLTIP_MS = 12_000` (UI_SPEC §13).
- **Memory DoD:** the unit suite asserts zero leaked observers and buttons across 10 thread switches on a 300-message fixture. Retained-heap measurement needs a real browser and runs in the Phase 8 E2E/perf suite.

## D-015 — Phase 5 overlay, contract additions, and deferred checks
**Date:** 2026-10-03 · **Phase:** 5 · **Affects:** `ARCHITECTURE.md` §2, §6, §8; `UI_SPEC.md` §2, §4, §9–§14; `EDGE_CASES.md` §10, §22

- **RPC additions (R12):**
  - `ui:openOptions` (content → worker, `payload: null`, returns `Ack`). Content scripts cannot call `chrome.runtime.openOptionsPage`; the sidebar gear and the banner "Manage"/"Export" actions need it.
  - `settings:changed` (worker → content, `payload: Settings`) is broadcast after every successful `settings:set`. Tabs apply settings live; a host toggled off tears down within one message round trip, and toggling it back on re-boots without a reload (EDGE_CASES §22). `ThreadRef`-only `store:changed` could not carry this.
- **Overlay CSS** lives in `overlay/styles.ts` as a string constant rather than `overlay.css?raw`. It is the same single string adopted into the shadow root, without needing a Vite-specific import type. Where constructable stylesheets are unavailable, a `<style>` element inside our own shadow root is used; it is equally isolated.
- **Host modal / fullscreen / text direction** are detected in `core/page-watch.ts` (generic ARIA `[role=dialog][aria-modal=true]`, `dialog[open]`, `document.fullscreenElement`, `dir`) and published in engine state. The overlay never reads host DOM (I2). Effective sidebar visibility is `sidebarOpen && !hostModal`, so closing the dialog restores the previous state automatically.
- **Role badges** read "User", "AI", "Msg" (`unknown`).
- **Composer-overlap rule (UI_SPEC §2)** is deferred. Measuring the host composer needs a new `HostAdapter` capability (a contract change), and the sidebar already sits in its own fixed layer with margins. It is tracked for Phase 8 review rather than changing the adapter contract in Phase 5.
- **Narrow viewports** (< `NARROW_VIEWPORT_PX = 640`) render the sidebar as a near-full-width sheet with the resize strip hidden.
- **Engine race guard:** wholesale pin-list replacements (`pins:reorder` reply, `pins:list`) are dropped when a newer local mutation happened while the call was in flight. Otherwise a slow reorder reply could resurrect a pin unpinned meanwhile.
- **DoD items that need a real rendering engine** are E2E (Phase 8, Playwright), not jsdom unit tests: aggressive-host-CSS screenshot diff (E11), hit-test grid (E12), axe-core audit, and contrast measurement. Unit tests cover mount isolation (host body unchanged before/after), the closed shadow root, `pointer-events` discipline, the keyboard walkthrough, text-only snippet rendering, filter, menu, tabs, host-modal deference, theme/motion/RTL attributes, banners, and the live region.
- New constants: `LABEL_COUNTER_FROM = 100`, `NARROW_VIEWPORT_PX`, `SIDEBAR_MARGIN_PX = 12`, `CLOCK_TICK_MS`.

## D-016 — Phase 6 background wiring
**Date:** 2026-10-03 · **Phase:** 6 · **Affects:** `BUILD_PLAN.md` Phase 6; `ARCHITECTURE.md` §8

- **No `tabs` permission and no port fallback.**
  - Hotkeys use the tab Chrome passes to `chrome.commands.onCommand`.
  - When that tab is absent, they fall back to `chrome.tabs.query({ active, currentWindow, url: <content-script patterns> })`. URL-filtered queries over origins we hold host permissions for need no `tabs` permission, and `tabs.sendMessage` needs none.
  - The port-based fallback BUILD_PLAN describes for a failed permission check is therefore not needed. Remapping lives in `chrome://extensions/shortcuts` as usual.
- **Context menu** registers once per install/update (`removeAll` + `create`), restricted with `documentUrlPatterns` taken from the manifest's own content-script matches, so the worker still names no host (I1). The forwarded selection is clamped to `MAX_SELECTION_CHARS = 2000`. It is data: the content script only uses it to locate the containing message (R6).
- **Multi-tab sync** reuses Phase 1's `store:changed` fan-out to every host tab. The receiving engine reloads the thread's pin list and redraws button state; it does not re-index.
- **Service-worker restarts** are covered by the store proxy's single idempotent retry (Phase 1) and the migrator's `ensure()` on every inbound RPC. The forced worker-stop scenario (E15) runs in the Phase 8 E2E suite.

## D-017 — Phase 7 popup, options, and their contract additions
**Date:** 2026-10-03 · **Phase:** 7 · **Affects:** `ARCHITECTURE.md` §2, §8; `UI_SPEC.md` §11–§12; `DATA_MODEL.md` §10

- **RPC additions (R12):**
  - `threads:remove` `{ hostId, threadIds }` → `{ removed, bytesReclaimed }` (Options → Prune). Each thread key is removed under its own lock. `bytesReclaimed` is the exact sum of the removed entries (key + JSON length, the same accounting as quota checks). The host index is rebuilt and `store:changed` is broadcast per thread.
  - `storage:wipe` `{ confirm: 'DELETE' }` → `{ removedKeys }`. It removes every `pp:v1:*` key, leaves foreign keys alone, resets the migrator so the next call writes fresh meta, and broadcasts `settings:changed` with defaults. It is allowed in read-only mode: a user-confirmed wipe is the way out of data a newer build wrote.
  - `ui:status` (popup → tab) → `TabStatus { hostId, status, threadId, transient, pinCount }` — a count, never content.
  - `ui:openSidebar` (popup → tab) → `Ack`.
- **Popup and options reach the active tab** with `chrome.tabs.query({ active, currentWindow, url: <content-script patterns> })` and `tabs.sendMessage`. No `tabs` permission is used (D-016). A tab without a live content script gets the "open a supported chat" copy.
- **Host labels and origins** for these pages live in `src/content/adapters/hosts.ts` (pure data), so host names stay inside `adapters/` (R2). The pages import that file only.
- **Shared page code** lives in `src/ui/` (`api.ts`, an injectable `PageApi` over the store proxy and `chrome.*`, and `page-styles.ts`, the overlay token set). It is not a new runtime context.
- **Sliders save on release** (`change`), not on every `input`, so a drag is one write and one broadcast.
- **Import** previews with `dryRun: true` and commits the same bundle and mode with `dryRun: false`. A test asserts the two reports' counts are identical.

## D-018 — Phase 8 E2E build, fixture server, and stalled-stream detection
**Date:** 2026-10-04 · **Phase:** 8 · **Affects:** `TESTING.md` §4; `TECH_STACK.md` §5; `ARCHITECTURE.md` §9.7; `EDGE_CASES.md` §1

- **`__E2E__` build flag.** `pnpm build:e2e` builds `dist-e2e` with mode `e2e`. Only that build:
  - adds `http://localhost/*` and `http://127.0.0.1/*` to the manifest matches and host permissions;
  - lets `isThreadUrl` accept `http://localhost` thread URLs (otherwise `https:` only);
  - picks the adapter on localhost from the first path segment (`/claude/...`, `/chatgpt/...`, `/gemini/...`);
  - mounts the overlay shadow root `open`, so Playwright can pierce it. The production build stays `closed`.
  - The flag is a compile-time define, so the production bundle contains none of this code. The release `dist` was checked to have no localhost strings and no open-shadow mount.
- **Fixture server** (`tests/e2e/server.ts`) renders the synthetic host fixtures on `localhost:4517` with a test-only runtime (virtualiser, streaming, cut stream, SPA switch). Nothing leaves the machine; E1 asserts that no request goes anywhere but the fixture server.
- **Playwright browser.** The harness uses Playwright's bundled Chromium when it is installed. Otherwise it uses `PW_CHROMIUM` or the newest `ms-playwright/chromium-*` it finds, so no browser download is required.
- **Stalled streams.** A streaming marker can stay set forever when the connection drops mid-reply. Adapters now treat a tail node as settled once its text length has not changed for `STREAM_TIMEOUT_MS` (`createStallDetector`), even if the marker is still present. This is the timeout fallback EDGE_CASES §1 already requires.

## D-019 — Navigation reach and scroll settle
**Date:** 2026-10-04 · **Phase:** 8 · **Affects:** `EDGE_CASES.md` §2; `ARCHITECTURE.md` §7

- **Recovery step sized to the mounted window.** A fixed `0.8 × viewport` step with 24 steps covers about 19 viewports, which is far short of a pin 300 turns away (E3, E19). Each step now moves the sweep so that the far edge of the currently mounted messages lands just inside the new viewport, keeping the spec's `0.2 × viewport` overlap. The viewport is always mounted, so consecutive windows never leave a gap. With a virtualiser's overscan the step grows to several viewports; without overscan it falls back to `0.8 × viewport`, which is the floor. The budget, abort, and turnaround rules are unchanged.
- **Zig-zag sweep.** Recovery alternates between extending the explored range upward and downward from the user's position, instead of running to one end before turning around. A pin is found after roughly twice its distance whichever side it is on, rather than after a full trip to the wrong end. When the pin's ordinal lies beyond the rendered window, the downward side goes first. `requestOlderMessages` is still tried whenever the upward side reaches the top.
- **Scroll settle tracks the target node.** `settle` now waits on the target's own position instead of the container's `scrollTop`, so window scrolling counts too. It does not declare the scroll settled before the node moves, unless `SCROLL_START_GRACE_FRAMES = 8` frames pass first. Smooth scrolling can take a few frames to start, and the old check placed the highlight at the pre-scroll position.
- **First-run tip** is clamped inside the viewport (`FIRST_RUN_TIP_WIDTH_PX = 240`). Centring it on a pin button near the left edge used to push its "Got it" button off-screen.
- **Rename focus** moves to the input in a layout effect, so a keystroke typed straight after F2 is not lost.

## D-020 — Phase 8 hardening report
**Date:** 2026-10-04 · **Phase:** 8 · **Affects:** `TESTING.md` §4–§8; `PRD.md` §9

**Defects found and fixed in Phase 8**

| ID | Defect | Fix |
|---|---|---|
| P8-1 (P0) | A mouse could not click a floating pin button. The button's hover restyle rewrote its own `style.cssText`, which dropped the fixed positioning, so the button jumped away under the pointer. | The floating button now sits in a positioned holder (`data-pinpoint-ui="floating"`), and only the holder is moved (unit test plus offline O17). |
| P8-2 (P1) | Recovery could not reach pins far away, or on the other side of the user's position (E3, E19). | Steps are sized to the mounted window and the sweep zig-zags (D-019). |
| P8-3 (P1) | The highlight was drawn before a smooth scroll started, or during a stall mid-scroll. | Settle tracks the target node and waits for `scrollend` once it has moved (D-019). |
| P8-4 (P1) | The first-run tip could render partly off-screen. | The tip is clamped to the viewport. |
| P8-5 (P2) | The first keystroke after F2 could be lost. | Focus moves in a layout effect. |
| P8-6 (P1) | Host CSS with universal `!important` rules could restyle the overlay host element. | Inline `!important` declarations on the host element (E11). |
| P8-7 (P1) | After an extension update the old content script showed "Couldn't … Try again". | An orphaned script maps transport failures to `VERSION_MISMATCH` and shows the reload banner (E18, unit test). |
| P8-8 (P1) | There was no offline-specific copy for turns the host must re-fetch. | `NOT_FOUND('offline')` with "reconnect to load it" (O9, unit test). |

**Results** (fixture pages, local Chromium build, `pnpm test:e2e`)

- **E2E:** E1–E20 automated and green, 31 tests in total. E2 is held to ±80 px. E11 allows a 0.1% pixel tolerance, via a dependency-free PNG diff.
- **E19:** 100 trials per host on a 300-message virtualised thread, every host 100/100.
  - Claude: p95 183 ms mounted, 3318 ms unmounted.
  - ChatGPT: p95 617 ms mounted, 3318 ms unmounted.
  - Gemini: p95 681 ms, all mounted.
  - Budgets are ≥ 99%, 2.5 s and 6 s. The suite's default is `E19_TRIALS=100`; use `E19_TRIALS=20` for a quick run.
- **Offline matrix:** O1–O14 and O16–O19 automated in one offline session; zero requests from the worker or extension pages.
  - O15 (reload the tab offline, page served from the host's cache) depends on the host's own caching. It is a manual check in the live-host pass.
  - O16's context-menu half cannot be clicked headless. The worker path it calls is unit-tested (`commands.test.ts`).
- **Performance:**
  - P1 idle: about 4 ms of script time per 10 s.
  - P2 storm: no long task, and every node is indexed.
  - P3 injection: p95 at most 140 ms.
  - P4 heap: +196 KB after 10 switches.
  - P8 first button: about 120 ms.
  - P5 counters: unit tests (`liveObserverCount`, `liveWatcherCount`).
  - P6/P7 size: `verify:size`.
- **Security checklist (TESTING §8):** all items pass.
  - No `innerHTML`, `eval`, or clipboard read in `src`.
  - No `console.*` in `dist`.
  - Manifest is `storage` + `contextMenus` with four https origins; no `externally_connectable`, WAR, or CSP key; `all_frames: false`.
  - The injected button carries only the opaque hash.
  - RPC, storage, and import validation are covered by the Phase 1 unit tests.

**PRD §9 success criteria**

| # | Criterion | Status |
|---|---|---|
| 1 | FR acceptance tests | Unit plus E2E green |
| 2 | Offline matrix | Green, except O15 (manual) |
| 3 | 300-message jump on all hosts | E19: 100/100 on each host |
| 4 | Scrambled class names | The `scrambled-classes` fixture runs through every adapter test in `hosts.test.ts` |
| 5 | Budgets | Met |
| 6 | Export → wipe → import | E16 deep-equal |

**EDGE_CASES coverage**

| § | Topic | Tests |
|---|---|---|
| 1 | Streaming | `hosts.test` (stalled streams), `engine.test`, E7, E8, P3 |
| 2 | Virtualisation | `navigator.test`, E3, E5, E19, O8 |
| 3 | Redesign | Selector tiers (`selectors.test`), scrambled fixture, health banner |
| 4 | SPA switch | `observer.test`, `engine.test`, E6, P4 |
| 5 | No thread id | `engine.test` (transient scope) |
| 6 | Branches | `hosts.test` (branched fixture) |
| 7 | Duplicate text | `identity.test` |
| 8 | Multi-tab | E14 |
| 9 | Worker termination | `store-proxy.test` (E15 unit), E15 |
| 10 | Host modals and fullscreen | `overlay.test` |
| 11 | Shadow DOM | `dom-utils.test` (deep query) |
| 12 | `extractText` | `dom-utils.test` |
| 13 | Long messages | `schema.test` (snippet clamps) |
| 14 | RTL | `overlay.test` |
| 15 | Zoom and small viewports | Manual check in the live-host pass. The narrow-sheet layout is unit-tested in `overlay.test` |
| 16 | Reduced motion | `inject.test`, E20 |
| 17 | Quota | `store.test`, E13 |
| 18 | Corrupt data | `store.test`, `migrate.test` |
| 19 | Extension update | `rpc-server.test`, `store-proxy.test`, E18 |
| 20 | CSP and Trusted Types | Lint rule, `inject.test` |
| 21 | Offline | Offline matrix |
| 22 | Host disabled | E17, `engine.test` |

**Not done in this phase:**

- The manual pass on live hosts (TESTING §2) needs a human with logged-in accounts. It covers O15, the context-menu click, and zoom/DPI.
- The composer-overlap rule (D-015) stays deferred: it needs a `HostAdapter` capability.
- On fixture pages, Gemini does not virtualise (its scroller keeps every turn mounted), so its E19 trials exercise only mounted navigation.

## D-021 — Phase 9 packaging and release material
**Date:** 2026-10-04 · **Phase:** 9 · **Affects:** `TECH_STACK.md` §4, §10; `BUILD_PLAN.md` Phase 9

- **No `archiver`.** TECH_STACK allows it as a dev dependency, but CLAUDE.md requires approval for any `package.json` dependency change. `scripts/zip.ts` therefore writes the ZIP itself (about 100 lines, `node:zlib` deflate and `crc32`).
  - Fixed timestamps make the archive byte-identical for the same build.
  - The script refuses `.map`, `tests/`, `docs/`, and `fixtures/` paths, and a manifest version that differs from `package.json`.
  - `readZip`/`extractZip` read the archive back with CRC checks. Unit tests cover round-trip, determinism, CRC failure, and the forbidden-path list.
- **Packaged-build smoke test.** `pnpm smoke:package` packages, extracts the zip to `release/unpacked`, and loads it in Chromium (`PP_EXT_DIR`). It checks that:
  - the worker answers RPC;
  - settings round-trip;
  - the popup and options page render with no errors;
  - the loaded manifest has the minimal permission set and no `localhost`;
  - zero requests reach the network.

  The release build matches no `localhost` origin, so host-page flows are verified on the E2E build. Both builds come from the same source and differ only in the D-018 flags.
- **Version sync** is the existing `verify:manifest` check (manifest vs `package.json`), which runs on every `pnpm build` and so on every `pnpm package`. `zip.ts` re-checks the built manifest.
- **Store material** lives in `store/`:
  - `LISTING.md`: copy, single-purpose statement, permission justifications, data-use answers;
  - `PRIVACY.md`: "does not collect user data";
  - `screenshots/`: generated from fixture pages by `pnpm store:screenshots`, never from real conversations. They show the unstyled fixture pages; polished marketing art is out of scope for this phase.
- The listing makes no claim beyond what is built and tested. Offline operation is evidenced by `verify:offline` and the offline matrix, the "messages the site has unloaded" claim by E3/E19, and accessibility by the overlay unit tests and E10.
