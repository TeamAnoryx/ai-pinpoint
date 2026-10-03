# Changelog

All notable changes to AI Pinpoint. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semantic versioning. Selector-set versions are listed per release, so a host-repair release is easy to trace (`docs/TESTING.md` §7).

## [1.0.0] — Unreleased

First release.

### Added
- Pin any message on Gemini (`gemini.google.com`), ChatGPT (`chatgpt.com`, `chat.openai.com`), and Claude (`claude.ai`), from:
  - the in-row pin button;
  - the context menu;
  - `Alt+Shift+P` (pins the last reply; a reply that is still streaming is pinned once it finishes).
- Sidebar (`Alt+Shift+S`) with pinned cards:
  - jump-to-message with a highlight;
  - rename (`F2`) and reorder (drag or `Alt+↑/↓`);
  - unpin with undo;
  - filter (`Alt+Shift+F`);
  - an "All chats" view of every pinned thread on the site.
- Navigation to messages the host has unloaded (virtualised threads): a budgeted, abortable recovery sweep. Pins are never deleted when a message cannot be found; the card offers a retry.
- Popup with per-site on/off and the current tab's pin count. Options page for:
  - theme, motion, highlight duration, and snippet length;
  - export and import (merge or replace, with preview);
  - storage use and pruning;
  - wiping all data.
- Works fully offline. All data stays in `chrome.storage.local` on the device.
- Accessibility: keyboard-only operation, screen-reader announcements, reduced-motion support, RTL layout.

### Security and privacy
- No network access of any kind; `verify:offline` fails the build on network-capable code or remote URLs.
- Minimal permissions: `storage`, `contextMenus`, and the four site origins above.
- Overlay isolated in a closed shadow root; no `innerHTML`; message text is always treated as data.

### Selector sets
- Gemini `2026.10.1`, ChatGPT `2026.10.1`, Claude `2026.10.1`, generic fallback `2026.10.1`.
