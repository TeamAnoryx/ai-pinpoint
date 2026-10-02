# TESTING — strategy, matrices, acceptance

Three layers: unit (Vitest + jsdom against fixtures), E2E (Playwright + real Chrome + local fixture pages), manual (live hosts). Offline testing is its own mandatory matrix (§6).

**Rule: no test may require the network.** Fixture pages are served from `localhost` by the Playwright web server; live-host manual passes are the only exception and they are never part of CI.

---

## 1. Test pyramid and coverage targets

| Layer | Scope | Target |
|---|---|---|
| Unit | hash/identity, validators, store mutations, adapters against fixtures, similarity, relative-time, order renormalisation | 90% line coverage on `src/shared/**`, `src/background/store.ts`, `src/content/core/identity.ts`; every adapter method × every fixture |
| Component | overlay components with mocked signals | render + interaction for every state in `UI_SPEC.md` §4 |
| E2E | boot → pin → navigate → unpin → reload → navigate, on virtualising fixture pages, per host adapter | all FRs in `PRD.md` §7 |
| Manual | live hosts, real threads | §2 matrix, once per release |

Coverage is a floor, not the goal. The specific assertions in §3–§5 are the real requirement.

## 2. Manual host matrix (once per release, and after any adapter change)

For each of Gemini, ChatGPT, Claude:

| # | Check | Pass condition |
|---|---|---|
| M1 | Pin button appears on user and assistant messages | present within ~0.4 s of the message completing |
| M2 | Pin a message mid-thread | card appears, toast shown, button turns filled |
| M3 | Reload the page, click the pin | navigates to the correct message, highlight visible |
| M4 | Pin in a 200+ message thread, scroll far away, click the pin | navigates correctly (recovery may engage) |
| M5 | Switch to another thread and back | pins correct for each thread, never mixed |
| M6 | New chat: pin before the thread has an id, then send a message | banner shown, then pins persist after id assignment |
| M7 | Edit a message to create a branch (ChatGPT/Claude), then click an older pin | navigates, or reports the branch-specific message |
| M8 | Open the same thread in two tabs, pin in one | second tab reflects it within 0.5 s |
| M9 | Host modal open (settings/share) | sidebar auto-collapses, host remains fully interactive |
| M10 | Hotkeys: pin-last, toggle sidebar, focus filter | all work; remapping in `chrome://extensions/shortcuts` takes effect |
| M11 | Context menu on a selected message | pins the containing message |
| M12 | Collapsed overlay | no host click is intercepted anywhere on the page |
| M13 | Pin a streaming reply | queues, then pins when the stream ends |
| M14 | Artifact/canvas/immersive panel open (host-specific) | pinning and navigation unaffected; pinned snippet excludes panel content |
| M15 | Zoom 50% and 200% | overlay usable, highlight aligned to the target |
| M16 | Disable the host in the popup | all injection disappears within 0.5 s; re-enable restores without reload |

Record results in `docs/release-checklists/<version>.md`.

## 3. Adapter unit tests

For each host, for each fixture in `ADAPTERS.md` §9:

```
A1  getObserverRoot()    → non-null, connected
A2  getScrollContainer() → non-null; scrollHeight > clientHeight on long-thread
A3  listMessageNodes()   → expected count, document order, no duplicates,
                           no composer/sidebar nodes included
A4  getRole()            → matches the fixture's expected role array
A5  getNativeId()        → non-null on hosts that expose ids; stable across two calls
A6  getText()            → equals the fixture's expected normalised text;
                           contains no button labels, no SVG text, no "Copy"/"Edit"
A7  getActionBarMount()  → non-null on fixtures with action rows; returns a
                           container that already holds >= 2 buttons
A8  getThreadId()        → expected id for the fixture's URL; null for new-chat URLs
A9  isStreaming()        → true only on the streaming fixture's last node
A10 probe()              → all capability flags true on the happy-path fixture
```

Plus the cross-cutting assertions:

- **Scrambled classes:** A3/A4/A6/A7 pass on `scrambled-classes.html`. If any fails, the adapter depends on tier-4 selectors and must be fixed (`ADAPTERS.md` §1).
- **No action rows:** A7 returns null on `no-action-rows.html` and the floating path is chosen.
- **Claude reasoning/artifact invariance:** `getText` output byte-identical with the reasoning block collapsed vs expanded, and with the artifact card present vs removed.
- **Tier reporting:** `createSelectorSet` reports which tier resolved each key; a test asserts that no key on the happy-path fixture resolves only at tier 4.

## 4. E2E suite (Playwright)

Fixture pages live in `tests/fixtures/pages/` and are served over `localhost`. One page per host adapter, each with:
- a configurable message count (`?n=300`)
- a real virtualiser that unmounts nodes more than 2 viewports away (`?virtual=1`)
- a simulated streaming mode (`?stream=1`)
- an SPA router that changes `history.pushState` on "thread" switch

To test host-specific adapters against these pages without real hosts, the pages replicate each host's structural signature (roles, data attributes, action-row shape) and the test harness overrides the registry match via a build-time test flag. **Do not** add host-detection branches to production code for testing.

| ID | Scenario | Assertions |
|---|---|---|
| E1 | boot on a 20-message page | buttons injected on all messages; sidebar handle visible; 0 console errors |
| E2 | pin → reload → navigate | pin persisted; target centred within ±80 px of viewport centre; highlight element present then removed after `HIGHLIGHT_MS` |
| E3 | pin → scroll 300 messages away → navigate (`virtual=1`) | recovery engages; target found; original scroll position not restored (navigation succeeded) |
| E4 | navigate to a pin whose message was deleted from the page | `NOT_FOUND` state after ≤ 8 s; original scroll position restored |
| E5 | user scrolls during recovery | recovery aborts within 200 ms; scroll position restored; card returns to idle |
| E6 | SPA thread switch | buttons removed and re-injected; pin list swapped; no stale cards; observer count returns to 1 |
| E7 | `stream=1`: pin-last hotkey during stream | intent queued; pin created after stream settles; hash matches the final text |
| E8 | stream never completes (simulated offline cut) | node indexed after `STREAM_TIMEOUT_MS`; pinning works |
| E9 | reorder by drag, then reload | order preserved |
| E10 | keyboard-only run: pin, ↓, Enter, F2, rename, Delete, undo | all succeed; focus never lost to the host |
| E11 | aggressive-host-CSS page | overlay visually unchanged (screenshot diff vs baseline, 0.1% tolerance) |
| E12 | collapsed overlay hit-test | clicks at a 10×10 grid of viewport points all reach host elements |
| E13 | quota: fill storage to 96% | new pin rejected with the quota banner; existing pins intact |
| E14 | two tabs, pin in tab A | tab B's list updates within 500 ms |
| E15 | service worker force-stopped, then pin | succeeds after worker wake; exactly one pin created (no duplicate from retry) |
| E16 | export → wipe → import | pin records field-identical (deep-equal assertion) |
| E17 | host toggle off | injection removed within 500 ms; no storage writes afterwards (spy on `storage.set`) |
| E18 | extension version mismatch simulation | content script tears down and shows the reload banner |
| E19 | 300-message page, 100 navigation trials to random pins | ≥ 99 successes; p95 time-to-highlight ≤ 2.5 s for mounted, ≤ 6 s for unmounted |
| E20 | reduced motion enabled | no smooth scrolling, static highlight, zero-duration transitions |

## 5. Performance and memory tests

Run against the 300-message virtualising fixture.

| ID | Measure | Budget |
|---|---|---|
| P1 | idle CPU with no mutations (30 s sample) | ≈ 0%; no timers firing more than once per 400 ms (the href tick) |
| P2 | mutation storm: 2000 records/s for 5 s | p95 per-batch main-thread work ≤ 2 ms; no batch > 16 ms; no dropped indexing (all nodes indexed at the end) |
| P3 | injection latency after a message completes | ≤ 400 ms p95 |
| P4 | retained heap after 10 thread switches | growth < 1 MB vs baseline (Chrome DevTools heap snapshot comparison) |
| P5 | observer/listener leak counter after 10 teardowns | returns to the boot-time count exactly |
| P6 | content-script bundle | ≤ 120 KB minified |
| P7 | total unpacked | ≤ 500 KB |
| P8 | time-to-first-button after `document_idle` | ≤ 1.5 s on the 300-message fixture |

`P4`/`P5` require instrumenting `__DEV__` counters for active observers, listeners, and rAF handles; the counters are compiled out of production.

## 6. Offline matrix (mandatory, blocking)

Procedure: load the fixture page (or a live host thread), then disable the network interface (or Chrome DevTools "Offline" throttling plus a real interface-level disconnect for the live pass). Then run every row. **Every row must pass.**

| # | Operation | Expected |
|---|---|---|
| O1 | Expand/collapse sidebar | works |
| O2 | Pin a rendered message | works, persisted |
| O3 | Unpin, then undo | works |
| O4 | Add/edit a label | works |
| O5 | Reorder pins by drag and by `Alt+↑/↓` | works, persisted |
| O6 | Filter pins | works |
| O7 | Navigate to a mounted pin | works, highlight shown |
| O8 | Navigate to an unmounted pin whose turns are still in the host's memory | works via recovery |
| O9 | Navigate to a pin whose turns the host must re-fetch | `NOT_FOUND('offline')` with the "not loaded — reconnect" copy, scroll restored |
| O10 | "All chats" tab | lists threads from the local index |
| O11 | Export | file downloads |
| O12 | Import that same file (merge) | dry-run then commit succeeds |
| O13 | Options page: all settings | load, change, persist |
| O14 | Storage stats and prune | accurate, works |
| O15 | Reload the tab while offline (host serves from cache) | extension boots, pins load |
| O16 | Hotkeys and context menu | work |
| O17 | Streaming detection on a stream cut by the disconnect | resolves via `STREAM_TIMEOUT_MS`; pinning works |
| O18 | Console during the whole run | zero network errors originating from the extension |
| O19 | DevTools Network tab filtered to the extension's origin | zero requests, for the entire session |

O19 is the decisive check. Any request attributed to the extension is a build-blocking defect.

Automated companion: `verify-offline.ts` (`TECH_STACK.md` §7) runs on every build; the matrix above is the runtime confirmation.

## 7. Regression suite for host changes

When a host ships a new build:

1. Capture a fresh fixture (`pnpm fixture:capture`).
2. Run `pnpm adapter:probe -- --fixture <new>` and record which tiers resolve.
3. Run the adapter suite (§3) against the new fixture.
4. Fix by **adding** selector tiers, never replacing working ones (`ADAPTERS.md` §10).
5. Re-run §3 against **all** fixtures, old and new, so the fix does not break rolled-back host builds.
6. Run E1, E2, E3, E6 for that host.
7. Bump `selectorsVersion`; note it in `CHANGELOG.md`.

## 8. Security review checklist

Run at Phase 8 and before every release.

- [ ] No `innerHTML` / `outerHTML` / `insertAdjacentHTML` anywhere (lint green)
- [ ] All pinned text rendered via `textContent`; labels length-clamped
- [ ] No `eval` / `new Function` / `importScripts`
- [ ] No `fetch` / XHR / WebSocket / EventSource / sendBeacon (verifier green)
- [ ] No `navigator.clipboard.readText`
- [ ] Manifest: only `storage` + `contextMenus`; four https host origins; no `externally_connectable`; no `web_accessible_resources`; no CSP key; `all_frames: false`
- [ ] SVG built via DOM APIs, not markup strings assigned to HTML
- [ ] Every inbound RPC payload validated before touching storage
- [ ] Every value read from storage validated; invalid records quarantined, not trusted
- [ ] Message content is never interpreted as instructions anywhere in the codebase (no parsing of pinned text for commands)
- [ ] Import path: schema/kind validated, array lengths clamped, unknown keys stripped, newer schema rejected
- [ ] Export contains only the user's own pins and settings — no diagnostics, no identifiers
- [ ] No logging of message content in production builds (`logger` compiled out; spot-check the bundle for snippet logging)
- [ ] Injected button carries no host data in attributes beyond the opaque hash

## 9. Acceptance mapping

Each `PRD.md` requirement maps to tests; all must pass for release.

| Req | Tests |
|---|---|
| FR-1 pin | A7, E1, E7, M1, M2, O2 |
| FR-2 navigate | E2, E3, E4, E5, E19, M3, M4, O7, O8, O9 |
| FR-3 label | E10, O4 |
| FR-4 reorder | E9, O5 |
| FR-5 unpin + undo | E10, O3 |
| FR-6 thread awareness | E6, M5, M6 |
| FR-7 cross-thread index | O10, manual |
| FR-8 filter | O6 |
| FR-9 per-host toggle | E17, M16 |
| FR-10 export/import | E16, O11, O12 |
| FR-11 keyboard | E10, E20, M10 |
| FR-12 quota | E13, O14 |
| NFR-1 offline | §6 entire matrix, verifier |
| NFR-2/3/5 perf | P1, P2, P3, P4, P5, P8 |
| NFR-4 size | P6, P7 |
| NFR-6 no CSS leakage | E11 |
| NFR-7 no layout shift | Phase 5 geometry snapshot |
| NFR-8 permissions | §8, verify:manifest |
| NFR-9 a11y | E10, axe audit, contrast check |
| NFR-10 degradation | A10 + no-action-rows fixture, M-host-change pass |
| NFR-11 privacy | §8 |

## 10. CI

```
on: [push, pull_request]
jobs:
  verify:
    - pnpm install --frozen-lockfile
    - pnpm lint
    - pnpm typecheck
    - pnpm test            # unit + component, with coverage thresholds
    - pnpm build           # includes verify:offline, verify:size, verify:manifest
    - pnpm test:e2e        # Playwright, local fixture server only
```

CI runs with no outbound network access beyond the package registry step. If a test needs the network, the test is wrong.
