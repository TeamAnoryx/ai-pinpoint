# EDGE CASES — failure modes and required mitigations

Each entry: the condition, why it breaks naïve implementations, and the mandatory mitigation. Agents must implement the mitigation, not a variant of it.

---

## 1. Streaming responses

**Condition.** Assistant messages arrive token-by-token. The DOM mutates hundreds of times per second; text length, node structure, and markdown rendering all change mid-stream.

**Why it breaks things.** (a) A hash computed mid-stream is wrong. (b) Unfiltered mutation handling pegs the CPU. (c) Action rows are added only after the stream ends, so early injection finds no mount.

**Mitigation.**
- Do not index a node while `adapter.isStreaming?.(node)` is true. Skip it; the next debounced batch retries.
- Generic streaming detection: sample `node.innerText.length` twice `STREAM_SAMPLE_MS` apart; stable → finished.
- Hard timeout `STREAM_TIMEOUT_MS` (6 s): if the length is still changing but no streaming marker is present, treat as finished and index. **This is required for offline correctness** — a host that loses connectivity mid-stream never fires a completion signal, and we must not wait forever.
- Mutation filter: drop records whose only change is `characterData` or text-node addition inside a node already flagged streaming. Mandatory; without it NFR-2 fails.
- If the user hotkey-pins while the last message is streaming, queue the intent and complete it when the stream settles; show the pin button in `busy` state meanwhile.

## 2. Virtual scrolling / unmounted DOM nodes

**Condition.** ChatGPT and Claude unmount off-screen turns on long threads. The pinned node simply does not exist in the DOM at click time.

**Why it breaks things.** `scrollIntoView` on a stale reference is a no-op; `querySelector` by hash finds nothing; naïve implementations show "not found" on perfectly valid pins.

**Mitigation — the recovery routine.** Implemented in `navigator.ts`, budget `RECOVERY_BUDGET_MS` (8 s), fully abortable.

```
recover(pin):
  container = adapter.getScrollContainer()
  if (!container) → NOT_FOUND('no-scroll-container')

  liveNodes = adapter.listMessageNodes()
  // direction estimate: compare pin.ordinal with the ordinals of live nodes
  direction = pin.ordinal < minLiveOrdinal ? 'up'
            : pin.ordinal > maxLiveOrdinal ? 'down'
            : 'bidirectional'

  step = container.clientHeight * 0.8
  attempts = 0
  while (elapsed < RECOVERY_BUDGET_MS && attempts < 24) {
    container.scrollTop += (direction === 'up' ? -step : step)
    await nextFrame(); await sleep(150)          // let the virtualiser mount
    reconcile()                                   // re-index newly mounted nodes
    hit = identity.resolve(pin)                   // steps 1–5 of DATA_MODEL §4
    if (hit) return SCROLL(hit)
    if (atTop(container)) {
      if (await adapter.requestOlderMessages?.()) { attempts++; continue }
      if (direction === 'up') direction = 'down'; else break
    }
    if (atBottom(container) && direction === 'down') {
      if (direction === 'down' && triedUp) break
      direction = 'up'; triedUp = true
    }
    attempts++
  }
  return NOT_FOUND('exhausted')
```

Requirements:
- Record the user's original `scrollTop` before recovery; on `NOT_FOUND`, restore it (do not leave the user lost somewhere in the thread).
- Show the card's `locating…` state from the first iteration.
- Abort immediately on user wheel/touch/keyboard scroll input, on a new navigation request, or on thread change; restore scroll position on abort.
- Never scroll the whole document when an inner container is the scroller — `getScrollContainer` is authoritative.
- Binary-search variants are tempting but unreliable with variable-height virtualisers: the linear sweep with direction estimation is the specified approach.

## 3. Host UI redesign / class-name churn

**Condition.** Hosts ship new builds with different class names, restructured action rows, or renamed test ids, with no notice.

**Mitigation.** Selector tier ladder and the fallback adapter — see `ADAPTERS.md` §1 and §7. Additionally:
- `health.probe()` after boot and after any reconcile that injects 0 buttons while ≥ 1 node exists.
- Degraded mode keeps the product partially usable (hotkey + context-menu pinning, snippet-based navigation) rather than failing closed.
- Log (locally, to the extension console only) which selector tier resolved each key. Never send this anywhere.
- Fixture suite including `scrambled-classes.html` runs in CI on every commit, so a tier-4-only dependency is caught before release.

## 4. Thread switching without page reload

**Condition.** All three hosts are SPAs. Switching conversations changes the URL via History API with no `load` event.

**Why it breaks things.** Stale pins from the previous thread remain visible; observers point at a detached root; pins get written to the wrong `threadId`.

**Mitigation.** `thread.ts` watches, in combination:
1. `window.addEventListener('popstate')`
2. Monkey-patched `history.pushState` / `replaceState` dispatching a custom event **from the content script's isolated world** (patching the page's own history requires the main world; instead use a polling+observer hybrid below — do not inject into the main world, it is fragile and raises CSP concerns)
3. A `MutationObserver` on `document.title` plus a 400 ms `location.href` comparison tick (cheap: one string compare)

On change: debounce `THREAD_SETTLE_MS` (300 ms), then — teardown per-thread state, clear injected buttons and indices, re-resolve `threadId`, reload pins, full reconcile, reset filter and tab state. Never reuse the previous hash index.

Also handle the **new-chat → assigned-id transition**: `transient:` scope promotes to a real thread id in one atomic write (`DATA_MODEL.md` §3).

## 5. Thread with no ID in the URL

**Condition.** Fresh chat before the first exchange; some host states (`/app`, `/`, temporary chats).

**Mitigation.** `transient:<hostId>:<nonce>` scope, memory-only, never persisted. Banner `degraded:no-thread` (`UI_SPEC.md` §10). Promote on id assignment. If the tab is closed before promotion, the pins are lost — this is correct and communicated, not a bug.

## 6. Branched / edited messages (ChatGPT, Claude)

**Condition.** Editing a message creates sibling branches; switching branches replaces the subtree below the edit point. Ordinals shift; content at a given position changes entirely.

**Mitigation.**
- Identity is id-first on hosts that expose ids; the ordinal is only a tiebreaker (`DATA_MODEL.md` §4).
- Resolution step 3 ("hash without ordinal, unique") is what makes a pin survive branch-induced ordinal shifts.
- If the pinned message belongs to a branch that is not currently displayed, recovery will exhaust. Report `NOT_FOUND('branch')` when the thread's message count changed by > 20% since pin time, and show the card copy "this message may be on a different edit branch" instead of a generic failure.
- Never auto-delete a pin on `NOT_FOUND`. The branch may come back.

## 7. Duplicate message text

**Condition.** User sends "yes" or "continue" ten times.

**Mitigation.** Ordinal tiebreak in the hash; ambiguity resolved by nearest ordinal; `⧉` duplicate marker on the card (`UI_SPEC.md` §4). Dedupe pins by `pinId` only, never by hash.

## 8. Multiple tabs on the same thread

**Condition.** The user opens the same conversation twice.

**Mitigation.** Single-writer service worker + `store:changed` broadcast (`ARCHITECTURE.md` §8, `DATA_MODEL.md` §6). Receiving tab refreshes overlay state only; it does not re-inject or re-index. Reorder operations send the full `orderedIds` array so last-write-wins is coherent rather than interleaved.

## 9. Service worker termination mid-operation

**Condition.** MV3 kills idle workers aggressively (~30 s). A write can be interrupted.

**Mitigation.**
- Every mutation is one `storage.set` after an in-memory lock — never a multi-await read-modify-write that can be severed (`DATA_MODEL.md` §6).
- Content script RPC calls have a 5 s timeout and **one** retry; a retry is safe because mutations are keyed by `pinId` (idempotent add, idempotent remove).
- No state is kept only in worker memory. The lock map is rebuilt empty on wake, which is correct because any interrupted operation either completed its single `set` or did not.
- Index rebuild (`rebuildIndex`) is available and idempotent if the index write was the interrupted step.

## 10. Host modal dialogs and fullscreen

**Condition.** Host opens a modal, or the user enters fullscreen / focus mode.

**Mitigation.** Auto-collapse while `[role="dialog"][aria-modal="true"]` is present (`UI_SPEC.md` §9). On `fullscreenchange`, hide the overlay entirely if the fullscreen element is not `documentElement`. Restore prior state afterwards.

## 11. Shadow-DOM and iframe hosts

**Condition.** Part of a host's UI may live in its own shadow root or an iframe (canvas/artifact panels, embedded previews).

**Mitigation.**
- Adapters may traverse *open* shadow roots via `el.shadowRoot` when searching for message nodes; implement `deepQueryAll` in `dom-utils.ts` with a depth cap of 6 and a node budget of 5000.
- Closed shadow roots are unreachable — if the conversation itself is inside one, probe returns 0 and we degrade. Do not attempt workarounds.
- **Never run the content script in iframes** (`all_frames: false`). Artifact/preview iframes are not message containers and running there wastes memory and may double-inject.

## 12. `extractText` contamination

**Condition.** `innerText` on a message node picks up button labels ("Copy", "Edit", "Regenerate", "Sources"), artifact card titles, collapsed reasoning text, and our own injected button's accessible text.

**Why it breaks things.** Hash instability: the same message hashes differently depending on hover state, artifact load state, or whether a disclosure is expanded.

**Mitigation.** `extractText` clones the node and removes, before reading text: `button`, `[role="button"]`, `svg`, `[aria-hidden="true"]`, `[data-pinpoint-btn]`, adapter-declared exclusion selectors (artifact cards, suggestion chips, source lists, reasoning disclosures). Then `normaliseText`. Every adapter must declare its exclusion list. Clone cost is acceptable because this runs once per node per reconcile, never per mutation.

## 13. Very long messages

**Condition.** A 20,000-character message with code blocks.

**Mitigation.** Hash uses head 256 + tail 128 + length, so cost is O(1) after text extraction. Snippet truncated to `settings.snippetChars` at a word boundary with an ellipsis. Never store full text (quota, `DATA_MODEL.md` §8).

## 14. RTL and non-Latin content

**Condition.** Arabic, Hebrew, CJK messages; mixed-direction text.

**Mitigation.** Normalise to NFC before hashing; strip bidi control characters (U+200E/F, U+202A–E) in `normaliseForHash` so copy/paste variants hash identically. Card text uses `dir="auto"`. CJK has no spaces — trigram similarity is used (not word-based), which handles this correctly. Sidebar layout mirrors when the host document `dir="rtl"`: flip `sidebarSide` default and icon chevrons.

## 15. Zoom, small viewports, and high DPI

**Condition.** Browser zoom 50–200%; narrow windows; split-screen.

**Mitigation.** All overlay sizing in `px` with `rem`-free math (host `font-size` may be odd) — zoom scales naturally. Below 900px viewport width the sidebar becomes an overlay sheet with a scrim (`pointer-events:auto` on the scrim, click to dismiss). Below 600px, collapse to handle-only and show pins in a bottom sheet. Highlight ring geometry is recomputed on `resize` and on `visualViewport` changes.

## 16. Reduced motion and accessibility settings

**Condition.** User has `prefers-reduced-motion: reduce`.

**Mitigation.** `behavior:'auto'` scrolling, no scale pulse, static highlight, zero-duration transitions (`UI_SPEC.md` §3). Honour `settings.reducedMotion` override in both directions.

## 17. Storage quota exceeded

Covered in `DATA_MODEL.md` §8. Edge-case specifics: a failed write must leave storage unchanged (single `set` guarantees this), the UI must report `QUOTA_EXCEEDED` with the export/prune actions, and the pin button must revert to unpinned rather than showing a false pinned state.

## 18. Corrupted or foreign storage data

**Condition.** A partial write from a killed worker, a hand-edited import, or data from a newer version.

**Mitigation.** Validate on every read (`DATA_MODEL.md` §2). On validation failure for a thread record: quarantine it under `pp:v1:quarantine:<key>` (do not delete), log once, present an empty pin list for that thread with a banner offering export of the raw record. On `meta.schema > SCHEMA_VERSION`: read-only mode, no writes at all.

## 19. Extension update mid-session

**Condition.** The extension updates while tabs are open; old content scripts keep running against a new service worker.

**Mitigation.** Every RPC carries the sender's extension version; the worker rejects calls whose major schema expectation differs, returning `VERSION_MISMATCH`. The content script then tears down and shows a one-line banner "Extension updated — reload this tab." Never attempt to hot-swap a content script.

## 20. Host CSP and `Trusted Types`

**Condition.** Hosts may enforce `require-trusted-types-for 'script'` and strict CSP.

**Mitigation.** We never assign to `innerHTML` or create scripts/styles in the host document (our styles live in `adoptedStyleSheets` on our own shadow root, which is unaffected). Build inline SVG via `document.createElementNS` or `DOMParser.parseFromString(svg, 'image/svg+xml')` and import the node — do not set `innerHTML` with SVG markup. No `eval`, no `new Function`, no `importScripts`.

## 21. Offline-specific behaviours (hard requirement)

**Condition.** Network disconnected, host page already loaded.

Required behaviours:
| Operation | Must work offline |
|---|---|
| Expand/collapse sidebar, filter, reorder, resize | yes |
| Pin / unpin / label an already-rendered message | yes |
| Navigate to a mounted pin | yes |
| Navigate to an unmounted pin | yes, as far as the host's cached DOM allows; if the host needs the network to re-fetch older turns, recovery returns `NOT_FOUND('offline')` with copy "this part of the chat isn't loaded — reconnect to load it" |
| Thread list (All chats) | yes (reads local index) |
| Export / import | yes (file system only) |
| Options page, storage stats, prune | yes |
| Streaming detection | yes — falls back to `STREAM_TIMEOUT_MS` |

Forbidden offline-related behaviour: any spinner that waits on a network event, any "retry when online" queue, any `navigator.onLine` gating of extension features. The extension must not care about connectivity at all; it only reports it when the *host's* content is unavailable.

## 22. Permissions revoked / host disabled mid-session

**Condition.** User toggles the host off in the popup while a tab is open.

**Mitigation.** `settings:set` broadcast triggers full teardown in every affected tab within 500 ms: observers disconnected, buttons removed, overlay unmounted, no further writes. Re-enabling re-boots the content script logic without a page reload.
