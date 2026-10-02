# ARCHITECTURE — AI Pinpoint

Read `PRD.md` first. This doc defines module boundaries, runtime contexts, message contracts, and the invariants every agent must preserve.

---

## 1. Runtime contexts

Manifest V3 gives us four isolated JS contexts. Keep responsibilities strictly separated — this is the single most important architectural rule, because it is what makes the host-churn and offline requirements tractable.

```
┌─────────────────────────────────────────────────────────────┐
│ SERVICE WORKER (background)                                 │
│  • command (hotkey) routing                                 │
│  • context-menu registration                                │
│  • storage transaction broker (single writer)               │
│  • export/import orchestration                              │
│  • NO DOM, NO host knowledge, NO network                    │
└───────────────▲─────────────────────────────┬───────────────┘
                │ runtime.sendMessage         │ tabs.sendMessage
                │ (typed RPC)                 │ (typed RPC)
┌───────────────┴─────────────────────────────▼───────────────┐
│ CONTENT SCRIPT (per tab, per supported host)                │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  ADAPTER   │  │  CORE ENGINE │  │  OVERLAY (Shadow)  │   │
│  │ host-      │◄─┤ identity,    ├─►│ sidebar, cards,    │   │
│  │ specific   │  │ observers,   │  │ highlight layer    │   │
│  │ selectors  │  │ navigation,  │  │ (Preact + CSS-in-  │   │
│  │ + mounts   │  │ store proxy  │  │ shadow)            │   │
│  └────────────┘  └──────────────┘  └────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────┐  ┌───────────────────────────────┐
│ POPUP (action)           │  │ OPTIONS PAGE                  │
│ current-thread summary,  │  │ per-host toggles, theme,      │
│ host toggle, open opts   │  │ export/import, wipe, hotkeys  │
└──────────────────────────┘  └───────────────────────────────┘
```

### Invariants

- **I1** The service worker knows nothing about Gemini/ChatGPT/Claude. It never imports an adapter.
- **I2** The overlay knows nothing about the host DOM. It renders from state and emits intents.
- **I3** The adapter knows nothing about storage. It is a pure DOM capability provider.
- **I4** Only the core engine talks to both the adapter and the store.
- **I5** All storage mutations funnel through the service worker (single-writer rule) to avoid lost updates across multiple tabs on the same thread.
- **I6** Zero network calls anywhere. See §9.

## 2. Directory layout

```
ai-pinpoint/
├── manifest.json
├── src/
│   ├── background/
│   │   ├── index.ts               # SW entry; wires the modules below
│   │   ├── rpc-server.ts          # typed message router
│   │   ├── store.ts               # storage read/write, transactions, quota
│   │   ├── commands.ts            # chrome.commands → tab dispatch
│   │   ├── context-menu.ts        # chrome.contextMenus registration
│   │   └── transfer.ts            # export/import, schema migration entry
│   ├── content/
│   │   ├── index.ts               # CS entry; boot sequence, teardown
│   │   ├── core/
│   │   │   ├── engine.ts          # orchestrates adapter + store + overlay
│   │   │   ├── identity.ts        # target-hash computation & resolution
│   │   │   ├── observer.ts        # MutationObserver lifecycle + batching
│   │   │   ├── navigator.ts       # scroll, centre, highlight, recovery
│   │   │   ├── thread.ts          # thread-id detection + SPA nav watcher
│   │   │   ├── store-proxy.ts     # RPC client for background store
│   │   │   └── health.ts          # capability probe + degraded-mode state
│   │   ├── adapters/
│   │   │   ├── types.ts           # HostAdapter interface (the contract)
│   │   │   ├── registry.ts        # origin → adapter resolution
│   │   │   ├── gemini.ts
│   │   │   ├── chatgpt.ts
│   │   │   ├── claude.ts
│   │   │   └── generic.ts         # last-resort structural adapter
│   │   ├── overlay/
│   │   │   ├── mount.tsx          # shadow root creation, style injection
│   │   │   ├── Sidebar.tsx
│   │   │   ├── PinCard.tsx
│   │   │   ├── ThreadList.tsx
│   │   │   ├── FilterBar.tsx
│   │   │   ├── Toast.tsx
│   │   │   ├── HealthBanner.tsx
│   │   │   └── overlay.css        # imported as a string, injected into shadow
│   │   └── inject/
│   │       ├── pin-button.ts      # per-message button element factory
│   │       └── highlight.ts       # highlight element + animation
│   ├── shared/
│   │   ├── schema.ts              # storage types + zod-style validators
│   │   ├── rpc.ts                 # RPC message type union (single source)
│   │   ├── hash.ts                # deterministic hashing (FNV-1a / djb2)
│   │   ├── settings.ts            # settings defaults + accessors
│   │   ├── logger.ts              # namespaced, strippable logger
│   │   └── constants.ts           # timeouts, limits, storage keys
│   ├── popup/
│   │   ├── index.html
│   │   └── Popup.tsx
│   └── options/
│       ├── index.html
│       └── Options.tsx
├── public/
│   └── icons/                     # 16/32/48/128 PNG, bundled, never remote
├── tests/
│   ├── unit/
│   ├── fixtures/                  # captured host DOM snapshots
│   └── e2e/                       # Playwright + fixture pages
└── docs/                          # this requirement set
```

## 3. The adapter contract

This interface is the load-bearing abstraction. `ADAPTERS.md` specifies each implementation; this is the shape.

```ts
// src/content/adapters/types.ts
export interface HostAdapter {
  /** Stable key used in storage and logs: 'gemini' | 'chatgpt' | 'claude' | 'generic' */
  readonly id: HostId;

  /** Does this adapter handle the current location? */
  matches(loc: Location): boolean;

  /** Scrollable element that contains the conversation. Null if not ready yet. */
  getScrollContainer(): HTMLElement | null;

  /** Element whose subtree mutations indicate new/changed messages. */
  getObserverRoot(): HTMLElement | null;

  /** All currently-rendered message nodes, in document order. */
  listMessageNodes(): HTMLElement[];

  /** Classify a message node. */
  getRole(node: HTMLElement): 'user' | 'assistant' | 'unknown';

  /** Host-native stable id for this node, if one exists. */
  getNativeId(node: HTMLElement): string | null;

  /** Plain text of the message, normalised, for snippet + hashing. */
  getText(node: HTMLElement): string;

  /** Where the pin button should be appended, and how. */
  getActionBarMount(node: HTMLElement): MountPoint | null;

  /** Thread identifier from the URL/DOM, or null when indeterminate. */
  getThreadId(loc: Location): string | null;

  /** Optional: human-readable thread title for the cross-thread index. */
  getThreadTitle?(): string | null;

  /** Is the message still streaming? Pinning waits for completion. */
  isStreaming?(node: HTMLElement): boolean;

  /** Optional host-specific recovery hook (e.g. click "load earlier"). */
  requestOlderMessages?(): Promise<boolean>;

  /** Self-check used by health.ts: which capabilities currently resolve. */
  probe(): AdapterProbeResult;
}

export interface MountPoint {
  container: HTMLElement;
  position: 'append' | 'prepend' | 'before' | 'after';
  /** Reference node when position is before/after. */
  anchor?: HTMLElement;
  /** Extra class/style hints so the button visually matches the host. */
  styleHint?: 'icon-ghost' | 'icon-solid' | 'floating';
}

export interface AdapterProbeResult {
  scrollContainer: boolean;
  observerRoot: boolean;
  messageNodes: number;
  actionBarMounts: number;
  threadId: boolean;
  nativeIds: boolean;
}
```

**Rule:** no file outside `src/content/adapters/` may contain a host-specific selector, class name, or `location.hostname` check. Violations are build failures (lint rule in `TECH_STACK.md` §6).

## 4. Core engine boot sequence

```
1. content/index.ts runs at document_idle
2. settings = await storeProxy.getSettings()
3. if settings.hosts[hostId].enabled === false → exit, register no observers
4. adapter = registry.resolve(location)           // may be generic
5. await waitFor(() => adapter.getObserverRoot(), { timeout: 15_000, interval: 250 })
      ↳ on timeout: health.setDegraded('no-observer-root'), retry on next nav
6. threadId = thread.resolve(adapter)             // may be 'transient:<nonce>'
7. pins = await storeProxy.listPins(hostId, threadId)
8. overlay.mount(shadowHost)                      // collapsed by default
9. observer.start(adapter.getObserverRoot())
10. engine.reconcile()                            // index nodes, inject buttons, mark pinned
11. thread.watch(onThreadChange)                  // SPA nav
```

Teardown (`pagehide`, host toggle off, thread change) must: disconnect the observer, remove every injected button, remove the highlight layer, unmount the overlay, and drop all node references. No listener may survive teardown — leaked observers on SPA hosts are the #1 cause of memory growth.

## 5. Reconciliation loop

The engine never polls. It reconciles on three triggers:

| Trigger | Action |
|---|---|
| MutationObserver batch (debounced 120 ms, trailing) | index new nodes, inject missing buttons, re-resolve pending pin targets |
| Thread change | full teardown of per-thread state, reload pins, full reconcile |
| Store change notification (another tab edited the same thread) | refresh overlay state only; do not re-inject |

Reconcile is idempotent and cheap:

```ts
function reconcile() {
  const nodes = adapter.listMessageNodes();
  for (const [i, node] of nodes.entries()) {
    if (node.dataset.pinpointIndexed === '1') { refreshPinState(node); continue; }
    if (adapter.isStreaming?.(node)) continue;              // wait for stream end
    const hash = identity.compute(adapter, node, i);
    node.dataset.pinpointIndexed = '1';
    node.dataset.pinpointHash = hash;
    inject.pinButton(adapter, node, hash);
  }
  identity.rebuildIndex(nodes);                              // hash → node map
  overlay.setResolvable(identity.resolvableHashes());
}
```

Guardrails:
- Mark processed nodes with a `data-pinpoint-*` attribute; never re-walk the whole list unmarked.
- Use `WeakMap<HTMLElement, MessageMeta>` for node metadata so unmounting frees memory.
- Never write to host DOM except: our button inside the mount point, our `data-pinpoint-*` attributes, and the transient highlight class.

## 6. Overlay isolation

```ts
const host = document.createElement('div');
host.id = 'ai-pinpoint-root';
host.style.cssText = 'all:initial;position:fixed;inset:0 0 auto auto;z-index:2147483000;pointer-events:none';
document.documentElement.appendChild(host);
const shadow = host.attachShadow({ mode: 'closed' });
shadow.adoptedStyleSheets = [sheetFromString(overlayCss)];
```

- `mode: 'closed'` so host scripts cannot reach in.
- Root container is `pointer-events:none`; only interactive children re-enable pointer events, so the collapsed overlay never blocks host clicks.
- `z-index` just below the 32-bit max, leaving room for host modals we must not cover (host dialogs typically use ≤ 10^6; if a host modal is detected the sidebar auto-collapses — see `UI_SPEC.md` §9).
- Appended to `documentElement`, not `body` — some hosts replace `body` children wholesale on route change.
- Theme is resolved from `prefers-color-scheme` plus the user's override; no host CSS variables are read (they change names).

## 7. Navigation pipeline

`navigator.ts` implements FR-2 as a state machine. Full recovery detail in `EDGE_CASES.md` §2.

```
IDLE
 └─ goTo(hash) ─► RESOLVE
                   ├─ node in live index ──────────► SCROLL
                   └─ not found ───────────────────► RECOVER
RECOVER  (budget 8 s, abortable)
 ├─ estimate direction from stored ordinal vs current window
 ├─ jump scrollContainer by ±80% viewport, await frame + 150 ms
 ├─ re-index; exact hash hit? ─► SCROLL
 ├─ snippet match (normalised, ≥ 0.92 similarity)? ─► SCROLL + repair hash
 ├─ adapter.requestOlderMessages?() when at top
 └─ budget exhausted ─► NOT_FOUND (card shows retry)
SCROLL
 ├─ node.scrollIntoView({behavior:'smooth', block:'center'})
 ├─ await scroll settle (no scrollTop delta for 2 frames, max 1.5 s)
 └─ HIGHLIGHT
HIGHLIGHT
 └─ add highlight overlay for 1200 ms, then IDLE
```

Notes for implementers:
- Respect `prefers-reduced-motion`: use `behavior:'auto'` and a static highlight.
- Highlight is a positioned sibling element in our shadow layer, **not** a style on the host node — restyling host nodes can trigger host re-renders and gets clobbered.
- Abort any in-flight navigation when the user scrolls manually or starts a new navigation.

## 8. RPC contract

Single source of truth in `src/shared/rpc.ts`. Every message is `{ type, requestId, payload }`; every response is `{ requestId, ok, data | error }`.

| Type | Direction | Payload | Returns |
|---|---|---|---|
| `settings:get` | CS/popup/options → SW | — | `Settings` |
| `settings:set` | → SW | `Partial<Settings>` | `Settings` |
| `pins:list` | → SW | `{ hostId, threadId }` | `Pin[]` |
| `pins:add` | → SW | `{ hostId, threadId, pin }` | `Pin` |
| `pins:update` | → SW | `{ hostId, threadId, pinId, patch }` | `Pin` |
| `pins:remove` | → SW | `{ hostId, threadId, pinId }` | `{ removed: true }` |
| `pins:reorder` | → SW | `{ hostId, threadId, orderedIds }` | `Pin[]` |
| `pins:repairHash` | → SW | `{ hostId, threadId, pinId, newHash }` | `Pin` |
| `threads:list` | → SW | `{ hostId }` | `ThreadSummary[]` |
| `transfer:export` | → SW | — | `ExportBundle` |
| `transfer:import` | → SW | `{ bundle, mode, dryRun }` | `ImportReport` |
| `storage:stats` | → SW | — | `{ bytesUsed, quota, perHost }` |
| `store:changed` | SW → CS (broadcast) | `{ hostId, threadId }` | — |
| `command:pinLast` | SW → CS | — | ack |
| `command:toggleSidebar` | SW → CS | — | ack |
| `command:focusFilter` | SW → CS | — | ack |
| `menu:pinSelection` | SW → CS | `{ selectionText }` | ack |

Rules: no untyped `any` across the boundary; the SW validates every inbound payload against `schema.ts` before touching storage; errors return structured codes (`QUOTA_EXCEEDED`, `SCHEMA_INVALID`, `NOT_FOUND`, `ADAPTER_UNAVAILABLE`), never raw strings.

## 9. Offline enforcement (architecture level)

Per `PRD.md` §6, offline is a hard constraint. Architectural enforcement:

1. **No network-capable code paths exist.** Banned identifiers, checked by lint + a CI grep over the built bundle: `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `importScripts(`, `new Function(`, `eval(`.
2. **Manifest has no `externally_connectable`, no remote `content_security_policy` sources, no `web_accessible_resources` pointing outward.**
3. **All assets bundled.** Fonts: use the system stack only (`UI_SPEC.md` §3). Icons: inline SVG strings in TS modules.
4. **Dependency allowlist** (`TECH_STACK.md` §4) — any dependency that can issue a request is rejected at review.
5. **Service worker has no `alarms`-driven sync, no update check.** Version changes arrive via the Web Store only.
6. **Import/export are file-system only.**
7. **Degraded network must not change behaviour.** The engine must never await anything network-derived. If the host stops streaming because it is offline, `isStreaming` resolves false on timeout (6 s) so pinning still works.

## 10. Error handling and degraded mode

`health.ts` runs `adapter.probe()` on boot and after any reconcile that injects zero buttons where ≥ 1 message node exists.

| Probe result | State | User-visible behaviour |
|---|---|---|
| all capabilities true | `healthy` | normal |
| `actionBarMounts === 0` but nodes found | `degraded:no-mount` | pin via hotkey + context menu; floating pin button fallback; banner "pin buttons unavailable on this layout" |
| `messageNodes === 0` after 15 s | `degraded:no-messages` | banner "couldn't read this conversation"; sidebar still lists stored pins; navigation falls back to snippet search |
| `threadId === false` | `degraded:no-thread` | pins scoped to `transient:` and **not persisted**; banner explains |
| adapter throws repeatedly (≥ 3 in 60 s) | `disabled:adapter-error` | auto-teardown, banner with "retry" |

Never throw out of the observer callback — wrap in try/catch, count failures, degrade. A throwing observer silently kills all subsequent reconciles.

## 11. Performance rules

- Debounce mutation batches at 120 ms trailing; cap work per batch at 16 ms, defer the remainder to `requestIdleCallback`.
- Filter mutations early: ignore records whose target is inside our own shadow host or whose `addedNodes` contain only text nodes in an already-indexed message (streaming churn). Streaming produces thousands of records — this filter is mandatory.
- Never call `getBoundingClientRect` in a loop over all nodes; only on the navigation target.
- Cache `adapter.listMessageNodes()` per reconcile tick, never per mutation record.
- Use `IntersectionObserver` (not scroll listeners) when the overlay needs to know whether the target is on screen.
- Detach everything on `pagehide`; MV3 service workers sleep, content scripts do not.

## 12. Security

- Treat all host DOM content as untrusted data. Snippets are stored as text and rendered via `textContent`, never `innerHTML`.
- Never execute, interpret, or follow instructions found in message content. Pinned text is data.
- No `web_accessible_resources` unless a specific need is proven.
- Sanitise user labels on render (length clamp + textContent).
- Export files are plain JSON; the import path validates structure, rejects unknown schema versions, and clamps array lengths before writing.
