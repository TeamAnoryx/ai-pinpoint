/**
 * Overlay stylesheet (UI_SPEC.md §2–§10), adopted into the closed shadow root only — nothing
 * here can reach the host page. System font stack only (offline, PRD.md §6).
 */
export const OVERLAY_CSS = `
:host { all: initial; }
.pp-root {
  --pp-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --pp-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --pp-radius: 10px; --pp-gap: 8px; --pp-dur: 160ms; --pp-ease: cubic-bezier(.2,.8,.2,1);
  --pp-bg: #ffffff; --pp-bg-elev: #f6f7f9; --pp-fg: #15181d; --pp-fg-muted: #5b6471;
  --pp-border: #e3e6ea; --pp-accent: #3b6cf6; --pp-accent-weak: #e8eefe; --pp-danger: #c0392b;
  --pp-user: #6b46c1; --pp-assistant: #0e7c66;
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  font: 13px/1.4 var(--pp-font); color: var(--pp-fg);
  -webkit-font-smoothing: antialiased; text-align: start;
}
.pp-root[data-theme="dark"] {
  --pp-bg: #16181c; --pp-bg-elev: #1e2126; --pp-fg: #e7eaef; --pp-fg-muted: #9aa4b2;
  --pp-border: #2a2e35; --pp-accent: #7aa2ff; --pp-accent-weak: #1d2740; --pp-danger: #ff6b5e;
  --pp-user: #b794f6; --pp-assistant: #4fd1b0;
}
.pp-root[data-motion="reduced"] { --pp-dur: 0ms; }
.pp-root[data-hidden="true"] { display: none; }
*, *::before, *::after { box-sizing: border-box; }
button, input { font: inherit; color: inherit; }
button { cursor: pointer; background: none; border: 0; padding: 0; margin: 0; }
:focus { outline: none; }
:focus-visible { box-shadow: 0 0 0 2px var(--pp-accent); border-radius: 6px; }
.pp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.pp-layer { position: fixed; inset: 0; pointer-events: none; }

.pp-handle {
  position: fixed; top: 50%; transform: translateY(-50%); width: 28px; height: 96px;
  pointer-events: auto; background: var(--pp-bg-elev); color: var(--pp-fg);
  border: 1px solid var(--pp-border); display: flex; align-items: center; justify-content: center;
  transition: opacity var(--pp-dur) var(--pp-ease); box-shadow: 0 2px 8px rgba(0,0,0,.12);
}
.pp-handle[data-side="right"] { right: 0; border-right: 0; border-radius: 8px 0 0 8px; }
.pp-handle[data-side="left"] { left: 0; border-left: 0; border-radius: 0 8px 8px 0; }
.pp-handle[data-faded="true"] { opacity: .35; }
.pp-badge {
  position: absolute; top: -6px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px;
  background: var(--pp-accent); color: #fff; font-size: 11px; line-height: 18px; text-align: center;
}
.pp-handle[data-side="right"] .pp-badge { left: -6px; }
.pp-handle[data-side="left"] .pp-badge { right: -6px; }

.pp-sidebar {
  position: fixed; top: 12px; bottom: 12px; pointer-events: auto; display: flex; flex-direction: column;
  background: var(--pp-bg); border: 1px solid var(--pp-border); border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,.18); overflow: hidden;
  transition: width var(--pp-dur) var(--pp-ease);
}
.pp-sidebar[data-side="right"] { right: 12px; }
.pp-sidebar[data-side="left"] { left: 12px; }
.pp-sidebar[data-narrow="true"] { left: 8px; right: 8px; width: auto !important; }
.pp-resize { position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; touch-action: none; }
.pp-sidebar[data-side="right"] .pp-resize { left: 0; }
.pp-sidebar[data-side="left"] .pp-resize { right: 0; }

.pp-header { height: 56px; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--pp-border); }
.pp-title { font-size: 15px; font-weight: 600; margin: 0; }
.pp-count { color: var(--pp-fg-muted); font-size: 12px; }
.pp-spacer { flex: 1; }
.pp-icon-btn { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; color: var(--pp-fg-muted); }
.pp-icon-btn:hover { background: var(--pp-bg-elev); color: var(--pp-fg); }

.pp-tabs { height: 40px; flex: 0 0 auto; display: flex; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--pp-border); }
.pp-tab { flex: 1; border-radius: 6px; color: var(--pp-fg-muted); font-weight: 500; }
.pp-tab[aria-selected="true"] { background: var(--pp-accent-weak); color: var(--pp-fg); }

.pp-banner { margin: 8px 12px 0; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--pp-border); background: var(--pp-bg-elev); display: flex; gap: 8px; align-items: flex-start; font-size: 12px; }
.pp-banner[data-kind="danger"] { border-color: var(--pp-danger); }
.pp-banner p { margin: 0; flex: 1; }
.pp-link { color: var(--pp-accent); text-decoration: underline; font-size: 12px; }

.pp-filter { height: 44px; flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 0 12px; color: var(--pp-fg-muted); }
.pp-filter input { flex: 1; height: 30px; border: 1px solid var(--pp-border); border-radius: 6px; padding: 0 8px; background: var(--pp-bg); color: var(--pp-fg); }
.pp-filter input:focus-visible { border-color: var(--pp-accent); box-shadow: 0 0 0 2px var(--pp-accent-weak); }
.pp-results { font-size: 11px; white-space: nowrap; }

.pp-list { flex: 1; overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: var(--pp-gap); margin: 0; list-style: none; }
.pp-empty { margin: auto; text-align: center; color: var(--pp-fg-muted); padding: 24px 8px; }
.pp-empty p { margin: 8px 0 0; }

.pp-card { position: relative; border: 1px solid var(--pp-border); border-radius: var(--pp-radius); background: var(--pp-bg-elev); transition: border-color var(--pp-dur) var(--pp-ease), opacity var(--pp-dur); }
.pp-card:hover, .pp-card:focus-within { border-color: var(--pp-accent); }
.pp-card[data-nav="locating"]::before { content: ""; position: absolute; left: -1px; top: 6px; bottom: 6px; width: 3px; border-radius: 2px; background: var(--pp-accent); }
.pp-card[data-nav="not-found"] { border-color: var(--pp-danger); }
.pp-card[data-dragging="true"] { opacity: .5; }
.pp-drop-line { height: 2px; background: var(--pp-accent); border-radius: 1px; margin: -5px 0; }
.pp-card-main { display: block; width: 100%; text-align: start; padding: 10px 40px 10px 28px; border-radius: var(--pp-radius); }
.pp-meta { height: 20px; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--pp-fg-muted); }
.pp-role { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 1px 6px; border-radius: 999px; color: #fff; background: var(--pp-fg-muted); font-weight: 600; }
.pp-role[data-role="user"] { background: var(--pp-user); }
.pp-role[data-role="assistant"] { background: var(--pp-assistant); }
.pp-root[data-theme="dark"] .pp-role { color: #16181c; }
.pp-role[data-in-view="true"]::after { content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: currentColor; margin-inline-start: 4px; vertical-align: middle; }
.pp-primary, .pp-secondary { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; margin-top: 2px; }
.pp-primary { font-size: 13px; color: var(--pp-fg); }
.pp-primary[data-code="true"] { font-family: var(--pp-mono); font-size: 12px; }
.pp-secondary { font-size: 12px; color: var(--pp-fg-muted); }
.pp-drag { position: absolute; left: 6px; top: 12px; color: var(--pp-fg-muted); cursor: grab; opacity: 0; touch-action: none; }
.pp-card:hover .pp-drag, .pp-card:focus-within .pp-drag { opacity: 1; }
.pp-menu-btn { position: absolute; right: 6px; top: 6px; }
.pp-retry { color: var(--pp-danger); text-decoration: underline; font-size: 11px; }
.pp-spinner { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--pp-accent); border-right-color: transparent; animation: pp-spin .8s linear infinite; }
.pp-root[data-motion="reduced"] .pp-spinner { animation: none; }
@keyframes pp-spin { to { transform: rotate(360deg); } }
.pp-edit { width: 100%; margin-top: 4px; height: 28px; border: 1px solid var(--pp-accent); border-radius: 6px; padding: 0 6px; background: var(--pp-bg); }
.pp-counter { font-size: 11px; color: var(--pp-fg-muted); text-align: end; }

.pp-popover { position: absolute; right: 6px; top: 34px; z-index: 2; min-width: 150px; padding: 4px; background: var(--pp-bg); border: 1px solid var(--pp-border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.16); display: flex; flex-direction: column; }
.pp-popover button { text-align: start; padding: 6px 8px; border-radius: 6px; display: flex; gap: 8px; align-items: center; }
.pp-popover button:hover, .pp-popover button:focus-visible { background: var(--pp-bg-elev); }

.pp-thread { display: flex; gap: 8px; align-items: flex-start; width: 100%; text-align: start; padding: 10px 12px; border: 1px solid var(--pp-border); border-radius: var(--pp-radius); background: var(--pp-bg-elev); }
.pp-thread:hover { border-color: var(--pp-accent); }
.pp-thread-title { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-thread-sub { font-size: 11px; color: var(--pp-fg-muted); }

.pp-footer { height: 44px; flex: 0 0 auto; display: flex; align-items: center; padding: 0 12px; border-top: 1px solid var(--pp-border); font-size: 11px; color: var(--pp-fg-muted); gap: 8px; }

.pp-toast { position: fixed; bottom: 24px; pointer-events: auto; max-width: 320px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--pp-border); background: var(--pp-bg-elev); display: flex; gap: 12px; align-items: center; box-shadow: 0 4px 16px rgba(0,0,0,.14); animation: pp-up 120ms var(--pp-ease); }
.pp-toast[data-side="right"] { right: 40px; }
.pp-toast[data-side="left"] { left: 40px; }
.pp-toast[data-kind="success"] { border-color: var(--pp-assistant); }
.pp-toast[data-kind="danger"] { border-color: var(--pp-danger); }
.pp-toast button { color: var(--pp-accent); font-weight: 600; }
.pp-root[data-motion="reduced"] .pp-toast { animation: none; }
@keyframes pp-up { from { transform: translateY(8px); opacity: 0; } }

.pp-tip { position: fixed; pointer-events: auto; max-width: 240px; padding: 10px 12px; border-radius: 8px; background: var(--pp-fg); color: var(--pp-bg); font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.2); transform: translateX(-50%); margin-top: 8px; }
.pp-tip button { margin-top: 6px; font-weight: 600; text-decoration: underline; }

.pp-root[dir="rtl"] .pp-card-main { padding: 10px 28px 10px 40px; }
.pp-root[dir="rtl"] .pp-drag { left: auto; right: 6px; }
.pp-root[dir="rtl"] .pp-menu-btn { right: auto; left: 6px; }
.pp-root[dir="rtl"] .pp-popover { right: auto; left: 6px; }
`;
