# PRD — AI Pinpoint (Chrome Extension)

**Doc owner:** product
**Status:** v1.0 requirements, frozen for build
**Read this first.** Every other doc in this set assumes the scope defined here.

---

## 1. Problem

Long AI chat threads (Gemini, ChatGPT, Claude) have no navigation primitive. The only way to return to an earlier message is manual scrolling through a virtualised, infinitely-growing DOM. Users lose:

- prompt constraints and system-style instructions set 50 messages ago
- code snippets they are iterating on
- outlines, specs, and decision points they keep re-deriving
- the "source of truth" message in a thread that has since drifted

Existing mitigations are all bad: re-pasting context (wastes tokens), opening a second tab, copying into an external notes app (breaks the link back to the thread), or `Ctrl+F` (matches the wrong occurrence, does not persist).

## 2. Product

A Manifest V3 Chrome extension that injects an overlay into supported AI web clients. The user pins any message in a thread; pinned messages appear as cards in a collapsible sidebar; clicking a card scrolls the conversation to that exact message and flashes a highlight on it.

One sentence: **browser bookmarks, but for individual messages inside an AI conversation.**

## 3. Target users

| Segment | Core need |
|---|---|
| Developers using AI for long refactors | jump back to the spec message and the last working snippet |
| Writers / researchers with 200-message threads | pin outline, pin style rules, pin sources |
| Power users running structured workflows | pin the "instructions" message, pin each phase boundary |
| Students / note-takers | pin explanations worth re-reading, export them later |

Assume a technical-to-semi-technical user on desktop Chrome. No mobile. No onboarding tour beyond a first-run tooltip.

## 4. Goals

**G1 — Zero-friction pinning.** One click on a pin icon that sits inline with the host's own message action buttons. No modal, no naming step. Labelling is optional and post-hoc.

**G2 — Reliable jump-to-message.** Clicking a pin card lands the user on the correct message ≥ 99% of the time within the same thread, including when the target node has been unmounted by the host's virtual scroller.

**G3 — Survives host UI churn.** Gemini/ChatGPT/Claude ship obfuscated, frequently-changing class names. A host redesign must degrade one adapter, never break the extension, and must be fixable by editing a single adapter file.

**G4 — Fully offline.** See §6. The extension has no backend, makes no network requests, and all features work with the network disconnected.

**G5 — Data portability.** JSON export/import of all pins, local and human-readable. The user's pins are never trapped in the extension.

**G6 — Invisible until wanted.** Collapsed by default to a thin edge handle. No host-layout shift, no CSS leakage, no interference with the host's own keyboard shortcuts.

## 5. Scope

### 5.1 In scope (v1.0)

- **Hosts:** `gemini.google.com`, `chatgpt.com` (+ `chat.openai.com`), `claude.ai`
- **Pin creation:** inline pin button per message; keyboard shortcut for "pin last message"; right-click context-menu entry on a selected message
- **Pin storage:** per host + per thread, in `chrome.storage.local`
- **Sidebar overlay:** collapsible, resizable, Shadow DOM, drag-to-reorder pins
- **Pin card:** role badge (user / assistant), optional user label, text snippet preview (first ~140 chars), relative timestamp, unpin, edit label, copy-snippet
- **Navigation:** smooth scroll to target, centre it in the viewport, temporary highlight pulse
- **Unmounted-node recovery:** progressive scroll-and-search until the target renders (see `EDGE_CASES.md` §2)
- **Thread switching:** detect SPA navigation, swap the pin set with no page reload
- **Search/filter:** filter pins in the current thread by substring; list all threads that have pins for the current host
- **Options page:** per-host enable/disable, sidebar side (left/right), theme (auto/light/dark), hotkey display, export, import, wipe
- **Export/import:** single JSON file, versioned schema
- **First-run hint:** one-time tooltip pointing at the pin button

### 5.2 Explicitly out of scope (v1.0)

- Cross-device sync (`chrome.storage.sync` is deferred — quota is 100 KB / 8 KB per item, too small for snippet payloads; see `DATA_MODEL.md` §7)
- Any server, account, or login
- Any AI/LLM call of our own (no summarising pins, no embeddings)
- Firefox / Safari / Edge-specific packaging (code must stay portable, but only Chrome is shipped and tested)
- Pinning a sub-range of a message (character-level selection anchors)
- Editing or injecting prompts into the host
- Sharing pins between users
- Reading or exporting whole conversation transcripts
- Mobile or tablet layouts

### 5.3 Non-goals (deliberate anti-features)

- We do not scrape or store full conversations — only the snippet needed to re-find a message.
- We do not fight the host for layout. If a host breaks overlay positioning, we fall back to a floating button, not a layout hack.
- We do not auto-pin anything. Pins are always an explicit user act.

## 6. Offline requirement (hard constraint)

**The extension must be 100% functional with the network interface disabled.** This is a correctness requirement, not an optimisation, and every agent must treat a network dependency as a build-breaking defect.

Concretely:

| Rule | Enforcement |
|---|---|
| No runtime `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` to any origin | CI greps the bundle; `ARCHITECTURE.md` §9 lists the banned identifiers |
| No remote fonts, CSS, or scripts | All assets bundled; `manifest.json` ships no `content_security_policy` relaxation |
| No icon sprites or images from a CDN | SVGs inlined in the bundle |
| No analytics, telemetry, crash reporting, or "check for updates" ping | Zero third-party SDKs; see `TECH_STACK.md` §4 dependency allowlist |
| No remote config / feature flags | Adapter selectors are compiled in; updates ship as extension versions |
| Storage is local-first | `chrome.storage.local` only in v1.0 |
| Export/import is file-based | `Blob` + `URL.createObjectURL` download, `<input type=file>` read; no upload endpoint |

**Offline acceptance test:** load a supported host from cache or an already-open tab, disconnect the network, then create / rename / reorder / delete / navigate-to / filter / export / import pins. All must succeed. Covered in `TESTING.md` §6.

Note the distinction for QA: the *host site* needs the network to produce new AI messages. The *extension* never does. Offline tests operate on an already-loaded thread.

## 7. Functional requirements

### FR-1 Pin a message
Given a rendered message node in a supported thread, when the user clicks the injected pin button, then a pin record is persisted within 100 ms and the sidebar shows a new card at the end of the list. Pinning is idempotent per message: a second click unpins.

### FR-2 Navigate to a pin
Given a pin card, when the user clicks it, then the conversation scrolls so the target message is vertically centred, and the message receives a 1.2 s highlight. If the node is unmounted, the recovery routine in `EDGE_CASES.md` §2 runs with a visible "locating…" state on the card and a hard timeout of 8 s, after which the card shows a "couldn't find this message" state with a retry action.

### FR-3 Label a pin
The user can attach a free-text label (max 120 chars) to a pin. The label replaces the snippet as the card's primary line; the snippet becomes secondary.

### FR-4 Reorder pins
Pins are user-orderable by drag within the sidebar. Default order is creation order. The order is persisted.

### FR-5 Unpin
Unpinning removes the record and the injected button returns to its unpinned state. An undo affordance is available for 5 s.

### FR-6 Thread awareness
On SPA navigation to a different thread, the sidebar repopulates with that thread's pins within 300 ms of the URL settling. Pins from the previous thread are never shown.

### FR-7 Cross-thread index
The sidebar has a second tab listing every thread on the current host that has pins, with pin counts and last-updated time. Selecting one navigates the host to that thread URL and then restores the sidebar to pin view.

### FR-8 Filter
A text input filters the current thread's pins by case-insensitive substring over label + snippet.

### FR-9 Per-host toggle
The user can disable the extension on a specific host from the options page or the popup. Disabled means: no injection, no observers, no storage writes for that host.

### FR-10 Export / import
Export writes one JSON file containing all hosts, all threads, all pins, plus a schema version. Import validates the schema version, then merges (default) or replaces (explicit choice), with a dry-run summary shown before commit.

### FR-11 Keyboard
- `Alt+Shift+P` — pin the last assistant message
- `Alt+Shift+S` — toggle sidebar
- `Alt+Shift+F` — focus the pin filter input
- `Esc` — close sidebar when focused
- `↑/↓` + `Enter` — move through and activate pin cards when the sidebar has focus

All bindings are declared via the `commands` manifest key so the user can remap them in `chrome://extensions/shortcuts`.

### FR-12 Storage pressure
When a host's pin data approaches the quota, the extension warns once and offers export + prune of the oldest threads. It never silently drops pins. See `DATA_MODEL.md` §8.

## 8. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Offline operation | 100% of features (see §6) |
| NFR-2 | Content script idle CPU | ≈0% when no DOM mutations; observer work ≤ 2 ms per mutation batch at p95 |
| NFR-3 | Injection latency | pin button present within 400 ms of a message finishing stream |
| NFR-4 | Bundle size | content script ≤ 120 KB minified; total unpacked ≤ 500 KB |
| NFR-5 | Memory | ≤ 8 MB retained per tab |
| NFR-6 | Zero CSS leakage | all overlay styles inside Shadow DOM; no global style tags in host |
| NFR-7 | No layout shift | host scroll position and element geometry unchanged by injection |
| NFR-8 | Permissions minimalism | `storage`, `scripting`, `contextMenus`, host permissions for the three hosts only. No `tabs`, no `<all_urls>`, no `webRequest` |
| NFR-9 | Accessibility | sidebar keyboard-navigable, ARIA roles on cards, visible focus rings, contrast ≥ 4.5:1 |
| NFR-10 | Graceful degradation | if an adapter's selectors fail, the extension shows a "host layout changed" state and still allows navigation by stored snippet search |
| NFR-11 | Privacy | no data leaves the device, ever; no clipboard reads; no reading of messages the user has not pinned |

## 9. Success criteria

Build is "done" for v1.0 when:

1. All FRs pass their acceptance tests in `TESTING.md`.
2. The offline matrix (`TESTING.md` §6) is fully green.
3. Jump-to-message succeeds on a 300-message thread on all three hosts, including targets that are unmounted at click time.
4. A simulated host-class-rename (test fixture with scrambled class names) does not break pinning or navigation — structural/role-based targeting carries it.
5. Bundle, memory, and permission budgets in §8 are met.
6. Export → wipe → import round-trips with byte-identical pin data.

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Host DOM redesign | pins stop injecting | adapter isolation (`ADAPTERS.md`), capability probe + health banner, structural selectors first |
| Virtual scroller unmounts targets | navigation fails | recovery routine + snippet matching (`EDGE_CASES.md` §2) |
| Message identity is unstable across reloads | pins point at the wrong message | layered ID resolution + content hash with position tiebreak (`DATA_MODEL.md` §4) |
| Thread ID not in URL on some host states | pins scoped wrongly | per-adapter thread-ID strategy with a `transient:` fallback scope that is never persisted |
| Storage quota on heavy users | writes fail | quota monitor, snippet truncation, prune flow (`DATA_MODEL.md` §8) |
| Chrome Web Store review flags broad permissions | ship delay | minimal permissions, no remote code, clear privacy statement (NFR-8, NFR-11) |

## 11. Glossary

- **Host** — a supported AI web client origin (Gemini / ChatGPT / Claude).
- **Adapter** — the per-host module that knows how to find messages and mount buttons.
- **Thread** — one conversation on a host, identified by `threadId`.
- **Message node** — the DOM element representing a single turn.
- **Target hash** — the durable identifier we compute for a message node.
- **Pin** — a stored reference to one message within one thread.
- **Overlay** — our Shadow DOM sidebar and highlight layer.
- **Recovery** — the routine that forces a host to render an unmounted target.
