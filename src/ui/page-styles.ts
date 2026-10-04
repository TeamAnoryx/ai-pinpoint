/**
 * Shared styles for the popup and options page (UI_SPEC.md §3, §11–§12): the overlay's token
 * set, system fonts only. These are extension pages, so light DOM styling is fine.
 */
export const PAGE_CSS = `
:root {
  --pp-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --pp-bg: #ffffff; --pp-bg-elev: #f6f7f9; --pp-fg: #15181d; --pp-fg-muted: #5b6471;
  --pp-border: #e3e6ea; --pp-accent: #3b6cf6; --pp-accent-weak: #e8eefe; --pp-danger: #c0392b;
  --pp-user: #6b46c1; --pp-assistant: #0e7c66;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --pp-bg: #16181c; --pp-bg-elev: #1e2126; --pp-fg: #e7eaef; --pp-fg-muted: #9aa4b2;
  --pp-border: #2a2e35; --pp-accent: #7aa2ff; --pp-accent-weak: #1d2740; --pp-danger: #ff6b5e;
  --pp-user: #b794f6; --pp-assistant: #4fd1b0;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--pp-bg); color: var(--pp-fg); font: 13px/1.45 var(--pp-font); }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--pp-accent); border-radius: 6px; }
h1 { font-size: 15px; margin: 0; }
h2 { font-size: 14px; margin: 0 0 10px; }
.muted { color: var(--pp-fg-muted); }
.btn { border: 1px solid var(--pp-border); background: var(--pp-bg-elev); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.btn:hover { border-color: var(--pp-accent); }
.btn[disabled] { opacity: .5; cursor: not-allowed; }
.btn-primary { background: var(--pp-accent); border-color: var(--pp-accent); color: #fff; }
.btn-danger { border-color: var(--pp-danger); color: var(--pp-danger); }
.row { display: flex; align-items: center; gap: 10px; }
.stack { display: flex; flex-direction: column; gap: 8px; }
.spacer { flex: 1; }
.switch { appearance: none; width: 34px; height: 20px; border-radius: 10px; background: var(--pp-border); position: relative; cursor: pointer; flex: 0 0 auto; margin: 0; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 120ms; }
.switch:checked { background: var(--pp-accent); }
.switch:checked::after { left: 16px; }
.bar { height: 8px; border-radius: 4px; background: var(--pp-bg-elev); border: 1px solid var(--pp-border); overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--pp-accent); }
.bar[data-level="warn"] > span { background: #d68a00; }
.bar[data-level="block"] > span { background: var(--pp-danger); }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: start; padding: 4px 8px; border-bottom: 1px solid var(--pp-border); }
.error { color: var(--pp-danger); }

.popup { width: 240px; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.popup footer { font-size: 11px; }

.options { max-width: 720px; margin: 0 auto; padding: 24px 20px 48px; display: flex; flex-direction: column; gap: 20px; }
.options section { border: 1px solid var(--pp-border); border-radius: 12px; padding: 16px; background: var(--pp-bg); }
.options label { display: flex; align-items: center; gap: 10px; }
.options input[type="range"] { flex: 1; }
.field { display: grid; grid-template-columns: 180px 1fr; gap: 10px; align-items: center; margin: 8px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--pp-bg-elev); padding: 1px 4px; border-radius: 4px; }
`;

/** Install the page stylesheet and keep `data-theme` in sync with the setting + OS. */
export function installPageTheme(getTheme: () => 'auto' | 'light' | 'dark'): () => void {
  const style = document.createElement('style');
  style.textContent = PAGE_CSS;
  document.head.append(style);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const apply = (): void => {
    const t = getTheme();
    document.documentElement.setAttribute('data-theme', t === 'auto' ? (mq?.matches ? 'dark' : 'light') : t);
  };
  apply();
  mq?.addEventListener('change', apply);
  return apply;
}
