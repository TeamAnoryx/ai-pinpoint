# BUILD PLAN — phased implementation

Ten phases. Each has deliverables, a definition of done, and the agent that owns it (see `AGENTS.md`). Phases are sequential; work inside a phase can parallelise where noted.

A phase is not done until its DoD is fully met. Do not start the next phase on a partially-done one — later phases assume the contracts from earlier ones are stable.

---

## Phase 0 — Scaffold and contracts

**Owner:** `extension-scaffolder`
**Depends on:** nothing

**Deliverables**
- Repo per `ARCHITECTURE.md` §2, pnpm + Vite + CRXJS + TS strict + Preact per `TECH_STACK.md`
- `manifest.json` exactly as `TECH_STACK.md` §3
- `src/shared/schema.ts` — all types and validators from `DATA_MODEL.md` §2
- `src/shared/rpc.ts` — the complete message union from `ARCHITECTURE.md` §8
- `src/shared/constants.ts` — all limits from `DATA_MODEL.md` §11
- `src/shared/hash.ts` — `fnv1a32`, `normaliseForHash`, `trigramSimilarity`
- `src/shared/logger.ts` — namespaced, `__DEV__`-gated
- `src/content/adapters/types.ts` — the `HostAdapter` interface verbatim
- ESLint flat config with every rule in `TECH_STACK.md` §6, including the two custom rules
- `scripts/verify-offline.ts`, `verify-size.ts`, `verify-manifest.ts`
- Stub entries for background / content / popup / options that build and load

**DoD**
- `pnpm build` passes, including all three verifiers
- Extension loads unpacked with no console errors on all four origins
- `pnpm lint` passes with `--max-warnings 0`
- Deliberately adding `fetch('https://x')` to any source file fails `pnpm build` (verified once, then reverted)
- No runtime dependency outside the §4 allowlist

---

## Phase 1 — Storage layer

**Owner:** `storage-engineer`
**Depends on:** Phase 0

**Deliverables**
- `src/background/store.ts` — `mutateThread` with the in-memory lock, single-`set` guarantee, index upsert/remove, `rebuildIndex`, `storageStats`, quota checks at `QUOTA_WARN_RATIO` / `QUOTA_BLOCK_RATIO`
- `src/background/rpc-server.ts` — typed router, payload validation on every inbound message, structured error codes, `VERSION_MISMATCH` check
- `src/background/transfer.ts` — export bundle builder, import with validate → migrate → dry-run → merge/replace, batched writes
- Migration framework from `DATA_MODEL.md` §9 (empty migration table, but the runner, backup, and read-only downgrade path exist)
- Quarantine path for invalid records (`EDGE_CASES.md` §18)
- `src/content/core/store-proxy.ts` — RPC client with 5 s timeout, one idempotent retry

**DoD**
- Unit tests: add/update/remove/reorder/repairHash round-trip; empty thread deletes its key and index entry; index rebuild matches a prefix scan; quota block returns `QUOTA_EXCEEDED` and leaves storage unchanged; invalid record quarantined not deleted; `meta.schema > SCHEMA_VERSION` enters read-only; export → wipe → import is field-identical
- Concurrency test: 50 interleaved `pins:add` calls for the same thread produce 50 pins with no lost updates
- Sparse-order renormalisation test: repeated mid-insertions trigger exactly one renormalise write when the gap closes

---

## Phase 2 — Adapter layer

**Owner:** `adapter-engineer` (one agent run per host; the three hosts can run in parallel after `dom-utils` lands)
**Depends on:** Phase 0

**Deliverables**
- `src/content/adapters/dom-utils.ts` — `findScrollableAncestor`, `normaliseText`, `extractText` (with the clone+strip rules of `EDGE_CASES.md` §12), `isElementStreaming`, `findButtonRow`, `deepQueryAll`
- `createSelectorSet` helper with tier tracking
- `gemini.ts`, `chatgpt.ts`, `claude.ts`, `generic.ts` per `ADAPTERS.md` §3–§6, each with `selectorsVersion` and an exclusion-selector list
- `registry.ts` with `resolve` + `withFallback` per `ADAPTERS.md` §7
- Fixtures for all three hosts per `ADAPTERS.md` §9, generated via `fixture:capture` (no real conversation text committed)
- `scripts/adapter-probe.ts` working against fixtures

**DoD**
- Every `HostAdapter` method tested against every fixture for its host
- `scrambled-classes.html` fixture: `messageNodes`, `getRole`, `getActionBarMount`, `getText` all still resolve (proves tier 1–3 independence)
- `no-action-rows.html`: `getActionBarMount` returns null and the floating path is selected
- Claude `artifact.html`: `getText` output is identical with the reasoning block collapsed vs expanded, and excludes artifact card text
- ChatGPT `branched.html`: `getNativeId` returns distinct ids per branch
- `extractText` output contains no button labels, no SVG text, no `data-pinpoint` artefacts
- No host-specific string exists outside `src/content/adapters/**` (lint rule green)

---

## Phase 3 — Identity and indexing

**Owner:** `identity-engineer`
**Depends on:** Phases 1, 2

**Deliverables**
- `src/content/core/identity.ts` — `compute`, `rebuildIndex` (WeakMap-backed node metadata + hash→node map), `resolve` implementing steps 1–5 of `DATA_MODEL.md` §4, `resolvableHashes`, `repair` dispatch
- Trigram similarity resolution with `SIMILARITY_THRESHOLD` and `MAX_SIMILARITY_SCAN` bail-out
- `src/content/core/observer.ts` — MutationObserver with `MUTATION_DEBOUNCE_MS` trailing debounce, streaming-churn filter, own-shadow-host filter, `RECONCILE_FRAME_MS` budget with `requestIdleCallback` continuation, try/catch with failure counting
- `src/content/core/thread.ts` — thread id resolution, transient scope + promotion, SPA navigation watcher (popstate + title observer + href tick), `THREAD_SETTLE_MS` debounce, teardown hook

**DoD**
- Hash stability tests: same fixture parsed twice → identical hashes; hover state, expanded reasoning, loaded artifact → identical hashes
- Hash distinctness: two messages sharing a 256-char prefix but differing in length or tail → different hashes
- Ordinal drift test: insert 3 messages above a pinned one → resolution succeeds via the hash-without-ordinal path and repairs
- Duplicate-text test: three identical "yes" messages → resolution picks the nearest ordinal and the pin is flagged duplicate
- Streaming test: node indexed only after stabilisation; indexed within `STREAM_TIMEOUT_MS` when no completion signal ever arrives (offline case)
- Perf test: 300-node fixture, simulated streaming mutation storm (2000 records/s for 5 s) → p95 batch work ≤ 2 ms, no dropped indexing
- SPA nav test: simulated `pushState` thread switch → old state fully torn down, new pins loaded, no stale buttons

---

## Phase 4 — Injection and navigation

**Owner:** `navigation-engineer`
**Depends on:** Phase 3

**Deliverables**
- `src/content/inject/pin-button.ts` — defensive inline-styled button per `UI_SPEC.md` §5, SVG built without `innerHTML` (`EDGE_CASES.md` §20), double-mount guard, re-mount on host re-render, `stopPropagation`
- Floating fallback rendered in the highlight layer, `IntersectionObserver` + rAF positioning
- `src/content/inject/highlight.ts` — highlight element, reposition on scroll/resize, reduced-motion variant
- `src/content/core/navigator.ts` — the full state machine of `ARCHITECTURE.md` §7 plus the recovery routine of `EDGE_CASES.md` §2: direction estimation, 0.8× viewport sweep, re-index between steps, `requestOlderMessages`, scroll-position save/restore, abort on user input or new navigation, 8 s budget
- `src/content/core/engine.ts` — boot sequence, reconcile loop, teardown, store-change handling
- `src/content/core/health.ts` — probe, degraded states, failure counting, auto-disable

**DoD**
- Pin button appears on every message in all three short-thread fixtures within 400 ms of index
- Clicking a mounted pin centres the target and highlights it; verified on all three hosts' long-thread fixtures
- Unmounted-target E2E: a virtualising fixture page that unmounts off-screen nodes → navigation succeeds from both directions
- Recovery abort: user scroll during recovery cancels it and restores the original scroll position
- `NOT_FOUND` after budget shows the retry state and restores scroll
- Teardown test: after thread change, zero injected buttons remain, zero observers remain connected (assert via a leak counter)
- Health test: fixture with no action rows → `degraded:no-mount`, hotkey pinning still works
- Memory test: 10 simulated thread switches on a 300-message fixture → retained heap growth < 1 MB

---

## Phase 5 — Overlay UI

**Owner:** `overlay-engineer`
**Depends on:** Phase 4 (can start against mocked engine state after Phase 3)

**Deliverables**
- `mount.tsx` — closed shadow root, `adoptedStyleSheets`, `documentElement` attachment, `pointer-events` discipline, theme resolution with live `matchMedia`
- `Sidebar.tsx`, `PinCard.tsx`, `ThreadList.tsx`, `FilterBar.tsx`, `Toast.tsx`, `HealthBanner.tsx`, `icons.ts`
- Signals store for overlay state; intents emitted to the engine, never direct DOM access
- All interactions from `UI_SPEC.md` §8: expand/collapse, pin/unpin with undo, navigate, inline label edit, drag reorder, `Alt+↑/↓` keyboard reorder, filter, resize, copy snippet
- Empty states, first-run tooltip, duplicate marker, in-viewport marker, locating/not-found card states
- Host-modal deference (`UI_SPEC.md` §9), fullscreen hiding, narrow-viewport sheet modes
- RTL mirroring, reduced-motion handling

**DoD**
- No style leakage: a host page with aggressive global CSS (`* { all: revert !important }` fixture) renders the overlay unchanged
- Host layout unchanged by mount/unmount (geometry snapshot comparison before/after)
- Collapsed overlay does not intercept clicks anywhere on the host (hit-test grid assertion)
- Full keyboard walkthrough: pin, navigate, rename, reorder, unpin, undo — mouse never used
- Axe-core (or equivalent) audit on the shadow tree: zero violations; contrast verified in both themes
- Drag reorder persists and survives reload
- 5 s undo restores the exact pin including label and order

---

## Phase 6 — Background wiring

**Owner:** `storage-engineer` (extends Phase 1)
**Depends on:** Phases 1, 4

**Deliverables**
- `src/background/commands.ts` — `chrome.commands` → active-tab dispatch for `pin-last`, `toggle-sidebar`, `focus-filter`, without the `tabs` permission (use `chrome.tabs.query({active:true,currentWindow:true})` — allowed under host permissions for matched origins; if it is not, dispatch via a port the content script opens on boot, which is the fallback design and **must** be implemented if the permission check fails)
- `src/background/context-menu.ts` — "Pin this message" on `selection` context, restricted to host documents
- `store:changed` broadcast fan-out to all tabs on the affected host
- `onInstalled` migration run + defensive migration on first RPC
- Version-mismatch rejection

**DoD**
- Each hotkey works on all three hosts and is remappable in `chrome://extensions/shortcuts`
- Context-menu pin resolves the selection to the containing message node and pins it
- Two tabs on the same thread stay in sync within 500 ms of a mutation in either
- Service-worker termination test (force-stop the worker, then act) → next RPC wakes it and succeeds
- No `tabs` permission in the manifest, or the port-based fallback is in use

---

## Phase 7 — Popup and options

**Owner:** `overlay-engineer`
**Depends on:** Phases 1, 6

**Deliverables**
- Popup per `UI_SPEC.md` §11
- Options page per `UI_SPEC.md` §12: hosts, appearance, behaviour, shortcuts (copyable text), data (usage bar, export, import with dry-run table, prune, wipe with typed confirmation), about
- Per-host disable triggers live teardown in open tabs (`EDGE_CASES.md` §22)

**DoD**
- Every setting persists and takes effect without a page reload where possible (side, theme, width, snippet length, highlight duration, reduced motion)
- Import dry-run numbers match the committed result exactly
- Prune reports accurate reclaimed bytes
- Wipe requires the typed token and clears every `pp:v1:*` key
- Toggling a host off removes all injection in open tabs within 500 ms

---

## Phase 8 — Hardening

**Owner:** `qa-engineer` with `security-reviewer`
**Depends on:** Phases 0–7

**Deliverables**
- Full E2E suite per `TESTING.md` §4 against fixture pages, plus a manual pass on live hosts per `TESTING.md` §2
- Offline matrix (`TESTING.md` §6) executed with the network interface disabled
- Perf and memory runs against budgets (NFR-2 through NFR-5)
- Security review per `TESTING.md` §8: no `innerHTML`, no clipboard read, no network, permission minimalism, snippet rendering via `textContent`, untrusted-content handling
- All `EDGE_CASES.md` entries have a corresponding test or a documented manual check

**DoD**
- Every `PRD.md` §9 success criterion verified and recorded
- Offline matrix 100% green
- 300-message thread navigation success rate ≥ 99% over 100 trials per host
- Bundle, memory, and permission budgets met
- No open P0/P1 defects

---

## Phase 9 — Packaging and docs

**Owner:** `release-engineer`
**Depends on:** Phase 8

**Deliverables**
- `pnpm package` producing a clean zip (no maps, tests, docs, fixtures)
- Store listing copy, screenshots from fixture pages (never real conversations), privacy statement ("does not collect user data")
- `README.md` — install from source, dev loop, architecture pointer, host-repair runbook pointer
- `CHANGELOG.md`
- Version sync check between `package.json` and `manifest.json`

**DoD**
- Zip loads as an unpacked-equivalent and passes a full smoke test
- `verify:*` all green on the packaged build
- Listing copy contains no claim the build cannot support

---

## Parallelisation map

```
P0 ──┬── P1 ──────────────┬── P6 ── P7 ──┐
     └── P2 ── P3 ── P4 ──┴── P5 ────────┴── P8 ── P9
```

- P1 and P2 are independent after P0.
- Within P2, the three host adapters are independent once `dom-utils` and `createSelectorSet` exist.
- P5 can begin against mocked state once P3 defines the engine's output shape.
- P8 cannot start early; it validates integration.

## Per-phase commit discipline

- One phase = one branch (`phase/3-identity`), small commits, each passing `pnpm lint && pnpm typecheck && pnpm test`.
- No phase merges with a failing verifier or a skipped test.
- Any deviation from these docs is recorded in `docs/DECISIONS.md` with the reason, before the code lands.
