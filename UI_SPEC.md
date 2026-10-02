# UI SPEC — overlay, cards, interactions

Everything here renders inside a closed Shadow DOM (`ARCHITECTURE.md` §6). Nothing may depend on host styles, and no style may escape to the host.

---

## 1. Surfaces

| Surface | Where | Purpose |
|---|---|---|
| Edge handle | fixed, vertically centred, on `settings.sidebarSide` | collapsed state; shows pin count badge; click/`Alt+Shift+S` expands |
| Sidebar | fixed, full height minus 24px margins, width `settings.sidebarWidth` | pin list, thread list, filter, settings shortcut |
| Pin button | injected into the host's message action row | create/remove a pin |
| Highlight layer | fixed, `pointer-events:none`, full viewport | draws the focus ring over the navigation target |
| Toast | bottom of sidebar side, above the handle | undo, errors, quota warnings |
| Health banner | top of sidebar content | degraded-mode explanations |
| Popup | extension action | current-thread summary, host toggle, open options |
| Options page | `chrome://extensions` → details → options | full settings, export/import, storage stats, prune |

## 2. Layout geometry

```
Collapsed (default):
  handle: 28 × 96 px, radius 8px on the inner side only,
          offset 0 from the chosen edge, vertically centred,
          badge: pin count, 18px circle, top-right of handle

Expanded:
  sidebar: width = settings.sidebarWidth (default 320, min 240, max 520)
           top/bottom margin 12px, edge margin 12px, radius 12px
           elevation: 0 8px 32px rgba(0,0,0,.18)
           resize: 6px drag strip on the inner edge, persists to settings
  rows:
    header     56px  — title "Pinned", count, collapse button
    tabs       40px  — "This chat" | "All chats"
    filter     44px  — search input (This chat tab only)
    list       flex  — scrollable, 8px gap
    footer     44px  — storage hint + settings gear
```

Sidebar must never overlap the host's composer: on expand, measure the host composer's bounding box; if the sidebar's edge would overlap it and the viewport is < 1280px wide, switch the sidebar to `position: fixed` with `bottom: composerHeight + 12px`. Do not modify host layout.

## 3. Visual language

Deliberately neutral so it reads as part of the browser, not the host.

```css
:host {
  --pp-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
  --pp-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --pp-radius: 10px;
  --pp-gap: 8px;
  --pp-dur: 160ms;
  --pp-ease: cubic-bezier(.2,.8,.2,1);
}
/* light */
--pp-bg: #ffffff;          --pp-bg-elev: #f6f7f9;
--pp-fg: #15181d;          --pp-fg-muted: #5b6471;
--pp-border: #e3e6ea;      --pp-accent: #3b6cf6;
--pp-accent-weak: #e8eefe; --pp-danger: #c0392b;
--pp-user: #6b46c1;        --pp-assistant: #0e7c66;
/* dark */
--pp-bg: #16181c;          --pp-bg-elev: #1e2126;
--pp-fg: #e7eaef;          --pp-fg-muted: #9aa4b2;
--pp-border: #2a2e35;      --pp-accent: #7aa2ff;
--pp-accent-weak: #1d2740; --pp-danger: #ff6b5e;
--pp-user: #b794f6;        --pp-assistant: #4fd1b0;
```

- **Fonts: system stack only.** No webfont, ever (offline requirement, `PRD.md` §6).
- **Icons: inline SVG** defined as TS string constants in `src/content/overlay/icons.ts`. 16×16 viewBox, `currentColor`, 1.5px stroke. Needed: pin, pin-filled, chevron-left/right, search, x, pencil, copy, drag-handle, trash, download, upload, alert-triangle, undo, external-link, settings.
- Theme resolution: `settings.theme === 'auto'` → `matchMedia('(prefers-color-scheme: dark)')`, live-updating. Never sniff host theme classes.
- Transitions respect `prefers-reduced-motion` and `settings.reducedMotion`: when reduced, `--pp-dur: 0ms` and the highlight is static.

## 4. Pin card

```
┌──────────────────────────────────────────────┐
│ ⠿  [USER]  2h ago                      ⋯    │   ← 24px meta row
│    Shift 07: Don't Look Away — the core…     │   ← primary (label or snippet)
│    …argument is that attention is a moral…   │   ← secondary (snippet, only when label exists)
└──────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Drag handle `⠿` | 16px, `--pp-fg-muted`, cursor `grab`, appears on hover/focus |
| Role badge | 10px uppercase, letter-spacing .04em, pill, `--pp-user` / `--pp-assistant`; `unknown` → `--pp-fg-muted` with label "MSG" |
| Timestamp | relative ("just now", "4m", "2h", "3d", then `DD MMM`); `title` attribute has the absolute local time |
| Primary line | 13px/1.4, `--pp-fg`, 2-line clamp |
| Secondary line | 12px/1.4, `--pp-fg-muted`, 2-line clamp, only rendered when a label exists |
| Overflow menu `⋯` | edit label, copy snippet, unpin; opens an in-shadow popover, closes on Esc/outside click |
| Card | padding 10px 12px, radius `--pp-radius`, bg `--pp-bg-elev`, 1px `--pp-border` |
| Hover | border `--pp-accent`, bg unchanged, cursor `pointer` |
| Active/navigating | left 3px `--pp-accent` bar + spinner in meta row + text "locating…" |
| Not-found state | border `--pp-danger`, meta row shows "couldn't find — retry" as a button |
| Duplicate-text marker | small `⧉` glyph after the role badge, `title="another message has identical text"` |
| Currently-visible marker | role badge gets a filled dot when the target is in the viewport (`IntersectionObserver`) |

Card is a `<button>`-semantics element: `role="button"`, `tabindex="0"`, `aria-label` = `${role} message, ${label ?? snippet}`. Enter/Space activate. The overflow menu is a separate focusable control (nested interactive elements use `role="group"` on the card instead of `role="button"` when a menu is present — implement as a card `div[role="group"]` containing a full-width `button` for navigation plus the menu button, to keep a11y valid).

**Snippet rendering is `textContent` only.** Never `innerHTML`. Code in snippets is not syntax-highlighted in v1 — a leading `` ` `` or detected code block renders the primary line in `--pp-mono` at 12px.

## 5. Injected pin button

Lives in host DOM, so it is styled defensively with inline styles.

```
unpinned: outline pin icon,  opacity .55, 24×24 hit area (28×28 target)
hover:    opacity 1, bg rgba(currentColor, .08), radius 6px
pinned:   filled pin icon, color var-free literal (#3b6cf6 light / #7aa2ff dark
          resolved at mount from prefers-color-scheme), opacity 1 always
busy:     1.2s rotating subtle ring (skip when reduced motion)
```

Requirements:
- `all: unset` as the first declaration, then explicit `display`, `width`, `height`, `cursor`, `color`, `background`, `border-radius`, `line-height`, `flex` properties.
- `aria-label`: "Pin this message" / "Unpin this message"; `aria-pressed` reflects state; `title` includes the hotkey hint.
- Keyboard focusable, visible focus ring drawn with `box-shadow: 0 0 0 2px <accent>` (outline can be suppressed by host CSS; box-shadow survives).
- On hover-only host action rows (ChatGPT), force `opacity: 1 !important` for the pinned state so the user can see what is pinned without hovering.
- Click handler calls `stopPropagation()` — host action rows often have their own click handlers on the container.
- Minimum 28×28 CSS px touch/click target (NFR-9).

**Floating fallback** (no action row found): a 24×24 button drawn in the *highlight layer* (our shadow overlay), positioned to the message node's bounding box, top-right, 4px inset, updated on scroll via `IntersectionObserver` + `requestAnimationFrame` only while the node is visible. This avoids writing to host styles entirely.

## 6. Highlight

```
element: absolutely-positioned div in the highlight layer, matched to the
         target node's bounding rect, 4px outset
style:   2px solid var(--pp-accent), radius 8px,
         background rgba(accent, .10)
anim:    0 → 1 opacity in 120ms, hold 900ms, fade out 180ms
         plus a single 1.02 → 1.00 scale pulse
reduced: static ring, hold 1200ms, no scale
```

Reposition the ring on scroll/resize while it is visible (rAF-throttled). Remove on any new navigation, on manual scroll of > 200px, or at `HIGHLIGHT_MS`.

## 7. Tabs

**This chat** — filter bar + ordered pin list. Empty state: pin icon, "No pins in this chat yet", and the hint "Click the pin icon on any message, or press Alt+Shift+P to pin the last reply."

**All chats** — thread list for the current host, sorted by `updatedAt` desc:

```
┌──────────────────────────────────────────────┐
│ Refactor auth middleware              7 pins │
│ claude.ai · yesterday                      ↗ │
└──────────────────────────────────────────────┘
```

Clicking navigates the host to `thread.url` (via `location.assign` in the content script — no `tabs` permission needed) and returns to the "This chat" tab after the thread settles. Threads whose host is not the current host are hidden (we only have permission and context for the active origin).

## 8. Interactions

| Action | Trigger | Result |
|---|---|---|
| Expand/collapse sidebar | handle click, `Alt+Shift+S`, Esc (collapse) | width transition `--pp-dur`; state persisted |
| Pin | pin button click, `Alt+Shift+P`, context menu | card appended with 200ms slide-in; toast "Pinned" |
| Unpin | pin button click (pinned), card menu, Delete key on focused card | card removes with fade; toast "Unpinned · Undo" for 5s |
| Navigate | card click/Enter | scroll + highlight (`ARCHITECTURE.md` §7) |
| Edit label | card menu, F2 on focused card | inline input replaces primary line; Enter saves, Esc cancels; 120-char counter appears past 100 |
| Reorder | drag handle | native pointer-events drag; 2px accent insertion line; `order` persisted on drop |
| Filter | `Alt+Shift+F` or click input | live substring filter; result count shown; Esc clears |
| Resize | drag inner edge | width persisted, clamped 240–520 |
| Copy snippet | card menu | `navigator.clipboard.writeText` (write only, never read); toast "Copied" |

Keyboard model inside the sidebar: `Tab` moves between regions (filter → tabs → list → footer); `↑/↓` move within the list without leaving it; `Home/End` jump; `Enter` navigates; `Delete` unpins with undo; `Esc` collapses. Focus is trapped only while a popover is open, never otherwise — the user must always be able to Tab back into the host page.

## 9. Host-modal deference

Hosts open dialogs (settings, share, upgrade) that must not be covered. Detect via `document.querySelector('[role="dialog"][aria-modal="true"]')` observed on the observer root's ancestor; while present, the sidebar auto-collapses to the handle and the handle drops to `opacity .35`. Restore previous state when the dialog closes. Never block host interaction.

## 10. Toasts and banners

Toast: single-line, 13px, 10px/12px padding, `--pp-bg-elev`, 1px border, radius 8px, auto-dismiss 3s (5s with an action), max one at a time (newest replaces), slide up 120ms. Variants: neutral, success, danger. Toasts must never contain host message content.

Health banner (top of sidebar content, dismissible per session):

| State | Copy |
|---|---|
| `degraded:no-mount` | "This layout hides the pin button. Use Alt+Shift+P or right-click a message to pin." |
| `degraded:no-messages` | "Couldn't read this conversation. Your saved pins are still here; jumping may be slower." |
| `degraded:no-thread` | "This chat has no ID yet — pins won't be saved until you send a message." |
| `disabled:adapter-error` | "Something changed on this site. [Retry]" |
| quota 80% | "Storage is 80% full. [Export] [Manage]" |
| quota 95% | "Storage full — new pins can't be saved. [Export] [Manage]" |
| read-only (newer schema) | "Your pins were saved by a newer version. Update the extension to edit them." |

Copy rules: plain language, no jargon, no blame, always an action where one exists. Max two lines.

## 11. Popup

240×auto. Contents: host name + enabled toggle; "N pins in this chat"; buttons "Open sidebar", "Export", "Settings"; footer with version. No pin list (the sidebar is the list) and no host content beyond a count.

## 12. Options page

Sections in order:
1. **Hosts** — one toggle row per host with its origin.
2. **Appearance** — side (left/right), theme (auto/light/dark), default collapsed, sidebar width slider, reduced motion.
3. **Behaviour** — snippet length slider (60–400), highlight duration (600–3000ms).
4. **Shortcuts** — read-only list of current bindings + a link that opens `chrome://extensions/shortcuts` (rendered as copyable text, since extensions cannot navigate there programmatically).
5. **Data** — storage usage bar with per-host breakdown; Export; Import (with dry-run summary table before commit); Prune (thread list with checkboxes, oldest first, shows bytes reclaimed); Wipe all (typed confirmation "DELETE").
6. **About** — version, "works fully offline — no accounts, no servers, no data leaves this device."

The options page is a standalone HTML page (light DOM is fine there — no host to pollute) but shares the token set and components where practical.

## 13. First-run

On first indexed message with `settings.firstRunDone === false`: draw a small pointer tooltip in the highlight layer anchored to the first visible pin button — "Pin any message. Pinned messages appear in the sidebar." with "Got it". Set `firstRunDone` on dismiss or after 12s. Shown once per install, never per host.

## 14. Accessibility checklist (NFR-9)

- Sidebar root `role="complementary"` with `aria-label="AI Pinpoint pinned messages"`.
- Pin list `role="list"`, cards `role="listitem"` containing the navigate button.
- Tabs use `role="tablist"/"tab"/"tabpanel"` with `aria-selected` and arrow-key navigation.
- Live region (`aria-live="polite"`) announces: "Pinned", "Unpinned", "Jumped to user message", "Couldn't find that message".
- All text ≥ 4.5:1 contrast in both themes; verify the muted tokens specifically.
- Focus visible on every interactive element via `box-shadow` ring, 2px, accent.
- No information conveyed by colour alone (role badges carry text; markers carry `title` + `aria-label`).
- Full keyboard operability with no mouse, including reorder (`Alt+↑/↓` on a focused card moves it).
