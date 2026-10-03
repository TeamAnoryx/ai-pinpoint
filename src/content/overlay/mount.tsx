/**
 * Overlay mount (ARCHITECTURE.md §6): one host element on <html>, a closed shadow root with
 * adopted styles, a pointer-events:none root, the highlight/floating layer, and the Preact app.
 * Theme follows settings + live prefers-color-scheme; nothing reads host CSS.
 */
import { render } from 'preact';
import { CLOCK_TICK_MS } from '@shared/constants';
import type { Engine } from '@content/core/engine';
import { App } from './App';
import { createOverlayModel, OverlayContext, type Intents } from './context';
import { OVERLAY_CSS } from './styles';

export const OVERLAY_HOST_ID = 'ai-pinpoint-root';

export interface OverlayHandle {
  /** Fixed, pointer-events:none layer for the highlight ring and floating pin buttons. */
  layer: HTMLElement;
  /** The themed root inside the shadow tree (tests and diagnostics). */
  root: HTMLElement;
  shadow: ShadowRoot;
  attach(engine: Engine, extra: Pick<Intents, 'openOptions' | 'copyText'>): void;
  destroy(): void;
}

function adoptStyles(shadow: ShadowRoot): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(OVERLAY_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    // Constructable stylesheets unavailable (old engines, test DOMs): a <style> in our own
    // shadow tree is equally isolated from the host.
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    shadow.append(style);
  }
}

function query(q: string): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(q) : null;
}

export function mountOverlay(): OverlayHandle {
  document.getElementById(OVERLAY_HOST_ID)?.remove(); // a stale instance from a dead script
  const host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  host.setAttribute('data-pinpoint-ui', 'root');
  // Inline !important beats any host stylesheet rule, including universal-selector !important.
  host.style.cssText =
    'all:initial!important;display:block!important;position:fixed!important;inset:0 0 auto auto!important;' +
    'z-index:2147483000!important;pointer-events:none!important;zoom:1!important';
  // <html>, not <body>: some hosts replace body children wholesale on route change.
  document.documentElement.append(host);
  // Closed so host scripts cannot reach in; open only in the E2E build so Playwright can (D-018).
  const shadow = host.attachShadow({ mode: __E2E__ ? 'open' : 'closed' });
  adoptStyles(shadow);

  const root = document.createElement('div');
  root.className = 'pp-root';
  const layer = document.createElement('div');
  layer.className = 'pp-layer';
  layer.setAttribute('data-pinpoint-ui', 'layer');
  const app = document.createElement('div');
  root.append(layer, app);
  shadow.append(root);

  const cleanups: (() => void)[] = [];

  return {
    layer,
    root,
    shadow,
    attach(engine, extra) {
      const { model, dispose } = createOverlayModel(engine.state);
      cleanups.push(dispose);
      const intents: Intents = { ...engine.intents, ...extra };

      const dark = query('(prefers-color-scheme: dark)');
      const reduce = query('(prefers-reduced-motion: reduce)');
      const applyTheme = (): void => {
        const s = engine.state.get();
        const theme = s.settings.theme === 'auto' ? (dark?.matches ? 'dark' : 'light') : s.settings.theme;
        const reduced = s.settings.reducedMotion === 'on' || (s.settings.reducedMotion === 'auto' && reduce?.matches === true);
        root.setAttribute('data-theme', theme);
        root.setAttribute('data-motion', reduced ? 'reduced' : 'full');
        root.setAttribute('dir', s.dir);
      };
      applyTheme();
      cleanups.push(engine.state.subscribe(applyTheme));
      dark?.addEventListener('change', applyTheme);
      reduce?.addEventListener('change', applyTheme);
      cleanups.push(() => {
        dark?.removeEventListener('change', applyTheme);
        reduce?.removeEventListener('change', applyTheme);
      });

      const onResize = (): void => {
        model.viewportWidth.value = innerWidth;
      };
      addEventListener('resize', onResize, { passive: true });
      cleanups.push(() => removeEventListener('resize', onResize));
      const tick = setInterval(() => (model.now.value = Date.now()), CLOCK_TICK_MS);
      cleanups.push(() => clearInterval(tick));

      render(
        <OverlayContext.Provider value={{ model, intents }}>
          <App />
        </OverlayContext.Provider>,
        app,
      );
      cleanups.push(() => render(null, app));
    },
    destroy() {
      for (const c of cleanups.splice(0).reverse()) c();
      host.remove();
    },
  };
}
