# ADAPTERS — per-host DOM targeting spec

Implements the `HostAdapter` contract from `ARCHITECTURE.md` §3. This is the **only** place in the codebase allowed to contain host-specific selectors.

---

## 1. Targeting doctrine

Host clients ship obfuscated, build-hashed class names that change without notice. Selector strategy is a strict priority ladder — always try tier 1 first, fall through on miss:

**Tier 1 — Semantics and ARIA (most durable).**
`[role="main"]`, `[role="article"]`, `[role="listitem"]`, `[aria-label]`, `<main>`, `<article>`, heading levels. These are tied to accessibility compliance, so hosts rarely remove them.

**Tier 2 — Stable data attributes.**
`data-message-id`, `data-message-author-role`, `data-testid`, `data-test-render-count`. Test ids survive longer than class names but are not contractual.

**Tier 3 — Structural relationships.**
"the scrollable ancestor of the message list", "the element containing exactly the copy/edit buttons", "nth child pattern repeating per turn". Expressed as predicates over the tree, not CSS strings.

**Tier 4 — Class-name *patterns* (last resort).**
Only regex/prefix matching on semantic-looking fragments (`[class*="message"]`, `[class*="turn"]`), never an exact hashed class.

**Forbidden.** Exact obfuscated classes (`.css-1x2y3z`), fragile `:nth-child(7)` paths from `body`, XPath strings, and anything derived from text in a specific language.

Every selector in an adapter must be declared through the helper so misses are logged and counted:

```ts
const q = createSelectorSet('gemini', {
  main:        { tiers: ['[role="main"]', 'main', '[class*="chat-window"]'] },
  messageNode: { tiers: ['[role="listitem"]', '[class*="conversation-container"]'] },
  // ...
});
q.one('main');        // first tier that matches; logs which tier won
q.all('messageNode');
```

`createSelectorSet` records, per key, which tier resolved. `health.ts` reports "resolved via tier 4" as a soft warning so we learn about host drift before it becomes a breakage.

## 2. Shared helpers (`adapters/dom-utils.ts`)

Implement once; all adapters use them.

```ts
findScrollableAncestor(el: HTMLElement): HTMLElement | null
  // walks up; returns first element with scrollHeight > clientHeight + 40
  // and computed overflow-y in (auto|scroll); falls back to
  // document.scrollingElement

normaliseText(raw: string): string
  // collapse whitespace, strip zero-width chars, trim, NFC normalise,
  // drop trailing "Copy"/"Edit"/"Regenerate" button labels captured by innerText

extractText(node: HTMLElement): string
  // clone node, remove [data-pinpoint-*], remove button/svg/[aria-hidden="true"],
  // remove our injected elements, then normaliseText(clone.innerText)

isElementStreaming(node: HTMLElement): boolean
  // true if node contains a known streaming marker OR its text length changed
  // between two samples 250 ms apart (generic fallback)

findButtonRow(node: HTMLElement): HTMLElement | null
  // deepest element within node containing >= 2 elements matching
  // button, [role="button"] and no block-level text content
```

`findButtonRow` is the generic action-bar locator and the main reason mounting survives redesigns.

## 3. Gemini adapter (`gemini.ts`)

**Match:** `gemini.google.com` (also accept `bard.google.com` redirect shell).

| Capability | Strategy |
|---|---|
| `getObserverRoot` | `[role="main"]` → `main` → `[class*="chat-window"]` |
| `getScrollContainer` | `findScrollableAncestor(firstMessageNode)`; Gemini commonly scrolls an inner container, not the document — never assume `document.scrollingElement` |
| `listMessageNodes` | `[class*="conversation-container"]` blocks, then within each, the user turn and model turn as separate nodes: match `[class*="user-query"]` / `[class*="model-response"]`, falling back to first/second child pattern |
| `getRole` | presence of a user-query subtree → `user`; model-response subtree → `assistant`; else infer by position parity within the container |
| `getNativeId` | Gemini exposes ids on response containers in some builds (`[id^="model-response-message"]`, `[id^="user-query"]`). Read `node.id` if it matches a known prefix, else `null` |
| `getText` | `extractText(node)`; exclude the "sources"/"suggestions" chip row (`[class*="suggested"]`, `[role="list"]` at the tail) |
| `getActionBarMount` | `findButtonRow(node)` — Gemini's thumbs/copy/share row. `position: 'append'`, `styleHint: 'icon-ghost'` |
| `getThreadId` | path segment after `/app/`: `/app/<id>` → `gemini:<id>`. On `/app` with no id (new chat) return `null` until the first response, then re-resolve |
| `getThreadTitle` | selected item text in the history rail (`[role="navigation"] [aria-selected="true"]`), else first user message snippet |
| `isStreaming` | presence of a stop-generating control in the composer region, **or** `isElementStreaming(node)` |
| `requestOlderMessages` | Gemini keeps full history mounted in most builds; return `false` (no-op) unless a "show more" control is found |

**Known Gemini quirks:**
- Angular-based; attribute names like `_ngcontent-*` appear on nodes — never match on them, they are build-specific.
- The composer area and the thread share ancestors; filter mutations originating in the composer subtree or every keystroke triggers a reconcile.
- Rich responses (tables, code, canvas/immersive panels) may render in a side panel that is a sibling of the thread. Pin the thread message, not the panel.
- Thread switch happens without full remount — `getThreadId` must be re-read on every URL change.

## 4. ChatGPT adapter (`chatgpt.ts`)

**Match:** `chatgpt.com`, `chat.openai.com`.

| Capability | Strategy |
|---|---|
| `getObserverRoot` | `[role="main"]` → the element containing `[data-message-id]` nodes |
| `getScrollContainer` | `findScrollableAncestor` from a message node; ChatGPT scrolls an inner div with `overflow-y:auto` |
| `listMessageNodes` | `[data-message-id]` (tier 2, very reliable here); fallback `[data-testid^="conversation-turn"]`; fallback `article` elements within main |
| `getRole` | `data-message-author-role` attribute (`user` / `assistant` / `system`); fallback: `[data-testid="conversation-turn-N"]` parity; fallback: presence of an avatar/edit-button signature |
| `getNativeId` | `node.dataset.messageId` — a UUID, stable for the lifetime of the thread. **Use it as the primary identity source for this host.** |
| `getText` | `extractText(node)`; drop the model-switcher label and the trailing action row |
| `getActionBarMount` | the hover action row (copy / thumbs / edit): `findButtonRow(node)`. Note it may be rendered only on hover with `opacity:0` — mount anyway and make our button `opacity:1` within its own stacking context so it stays visible (`UI_SPEC.md` §5) |
| `getThreadId` | `/c/<uuid>` → `chatgpt:<uuid>`. `/` or `/?model=` (fresh chat) → `null` until the URL gains an id |
| `getThreadTitle` | `document.title` minus the site suffix; else sidebar active item |
| `isStreaming` | presence of the stop-streaming button, or `[data-message-id]` node carrying a streaming data attribute, or `isElementStreaming` |
| `requestOlderMessages` | ChatGPT virtualises long threads: scroll the container to `scrollTop - viewport*0.9` and wait for node count to grow; return whether it grew |

**Known ChatGPT quirks:**
- `data-message-id` is present and stable — highest-confidence host. Still compute a content hash as a secondary key so imported pins from a different session can be matched.
- Turn wrappers and message nodes are different elements; the action row belongs to the turn wrapper, the id to the message. Resolve the mount by walking up from the `[data-message-id]` node to the nearest turn wrapper.
- Branch/edit history ("< 2/3 >") can change which message renders at a given position. Identity must be id-first here, never index-first.
- Canvas/side panels replace main content; `getObserverRoot` must be re-resolved if it is detached (`!root.isConnected`).

## 5. Claude adapter (`claude.ts`)

**Match:** `claude.ai`.

| Capability | Strategy |
|---|---|
| `getObserverRoot` | `[role="main"]` → the element containing `[data-test-render-count]` or message blocks |
| `getScrollContainer` | `findScrollableAncestor` from a message node |
| `listMessageNodes` | `[data-testid="user-message"]` and the assistant message blocks (`[class*="font-claude"]` pattern as tier 4, preferred: the sibling block following a user message inside the same turn group). Prefer: group container → two children (user, assistant) |
| `getRole` | user-message test id → `user`; otherwise `assistant` |
| `getNativeId` | generally absent → `null`; rely on computed hash |
| `getText` | `extractText(node)`; exclude artifact preview cards (they are references, not message text) and the "thinking" disclosure block unless expanded |
| `getActionBarMount` | `findButtonRow(node)` (copy / retry row). If absent (user messages often have only an edit control on hover) use `position:'after'` on the message block with `styleHint:'floating'` |
| `getThreadId` | `/chat/<uuid>` → `claude:<uuid>`; project chats `/project/<pid>/chat/<cid>` → `claude:<cid>`; new chat → `null` |
| `getThreadTitle` | `document.title` minus suffix; else sidebar active item |
| `isStreaming` | stop control present, or `isElementStreaming` |
| `requestOlderMessages` | scroll-up-and-wait, same as ChatGPT |

**Known Claude quirks:**
- Artifacts open a side panel; messages referencing an artifact contain a card element — strip it from text extraction so the hash is stable whether or not the artifact is loaded.
- Collapsible "thinking" sections change message text length when toggled. **Exclude collapsed/expandable reasoning regions from `getText` entirely** so a hash does not change when the user expands them. This is mandatory for identity stability.
- No native message ids in most builds → the content-hash path is the primary identity. Test this host hardest for identity collisions.

## 6. Generic adapter (`generic.ts`)

Last-resort adapter used when a known host's probe fails badly, or for future hosts.

- `getObserverRoot`: `[role="main"]` → `main` → `document.body`
- `listMessageNodes`: elements matching `[role="article"], [role="listitem"], article` inside the root, filtered to those with ≥ 40 chars of text; if none, cluster by repeated structural signature (same tag + same child-shape, ≥ 3 occurrences)
- `getRole`: alternate `user`/`assistant` by position, or `unknown`
- `getActionBarMount`: `findButtonRow(node)`, else `{ position:'after', styleHint:'floating' }`
- `getThreadId`: last path segment if it looks like an id (`/[0-9a-f-]{8,}/`), else `null` (transient scope)

The generic adapter must never be silently used for a known host — selecting it for `chatgpt.com` means the real adapter failed and `health.ts` must report `degraded`.

## 7. Registry resolution

```ts
const adapters = [geminiAdapter, chatgptAdapter, claudeAdapter];

export function resolve(loc: Location): HostAdapter {
  const direct = adapters.find(a => a.matches(loc));
  if (!direct) return genericAdapter;               // should not happen: host perms are narrow
  const probe = direct.probe();
  if (probe.messageNodes === 0 && probe.actionBarMounts === 0) {
    logger.warn('adapter probe empty, falling back to generic', direct.id, probe);
    return withFallback(direct, genericAdapter);     // keeps id + threadId from the real one
  }
  return direct;
}
```

`withFallback` keeps `id`, `getThreadId`, and `getThreadTitle` from the real adapter (so storage scoping stays correct) while delegating node discovery to generic. This is what prevents a host redesign from orphaning stored pins.

## 8. Mounting the pin button

```ts
function mountPinButton(adapter, node, hash) {
  const mp = adapter.getActionBarMount(node);
  const btn = createPinButton({ hash, styleHint: mp?.styleHint ?? 'floating' });
  if (!mp) { mountFloating(node, btn); return; }
  switch (mp.position) {
    case 'append':  mp.container.appendChild(btn); break;
    case 'prepend': mp.container.prepend(btn); break;
    case 'before':  mp.anchor!.before(btn); break;
    case 'after':   mp.anchor!.after(btn); break;
  }
}
```

Requirements:
- The button is a single `<button>` with `data-pinpoint-btn="1"`, `aria-label`, `title`, inline SVG icon, and **inline styles only** (host stylesheets would otherwise restyle it; we cannot put it in our shadow root because it must live inside the host's action row).
- Inline styles start with `all: unset` then minimal declarations, so host CSS cannot bleed in.
- Mark the host container with `data-pinpoint-mounted="1"` to avoid double-mounting.
- The button must be re-mounted if the host re-renders the row (observer catches removal: if a node is indexed but its button is `!isConnected`, re-mount).
- Hover-only action rows: set our button's `opacity:1 !important` and give the parent a `data-pinpoint-has-pin="1"` hook so pinned messages show the icon persistently.
- Floating fallback: absolutely positioned within a `position:relative` wrapper we add to the message node's own style **only if** the node has `position:static`; otherwise position relative to the node's bounding box via our shadow overlay layer (preferred — avoids touching host styles at all).

## 9. Adapter test fixtures

Each adapter ships with captured DOM fixtures in `tests/fixtures/<host>/`:

- `short-thread.html` — 4 messages, all mounted
- `long-thread.html` — 120 messages, scroll container present
- `streaming.html` — last message mid-stream
- `scrambled-classes.html` — same as short-thread with all class attributes randomised (proves tier 1–3 targeting)
- `no-action-rows.html` — action rows removed (proves floating fallback)
- `branched.html` (ChatGPT) — edited message with sibling branches
- `artifact.html` (Claude) — message with artifact card + collapsed thinking block
- `immersive.html` (Gemini) — response with side panel

Adapter unit tests assert every `HostAdapter` method against every fixture. A new host build = capture a new fixture, run the suite, fix the failing tier. See `TESTING.md` §3.

## 10. Adding or repairing a host (runbook)

1. Open the host, open devtools, capture the thread container outerHTML into a fixture file. Strip personal content, keep structure.
2. Run `npm run adapter:probe -- --fixture tests/fixtures/<host>/<file>.html` to print which tiers resolve.
3. Fix selectors **top-down**: prefer adding a tier-1/2 candidate over adding a tier-4 pattern.
4. Add the new tier to the existing `tiers` array — never replace a working one; keep both so older/rolled-back host builds keep working.
5. Run the full adapter suite plus the scrambled-classes fixture.
6. Bump the adapter's `selectorsVersion` constant so logs identify which selector set is running.
