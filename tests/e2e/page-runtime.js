/*
 * Fixture-page runtime (TESTING.md §4) — test-only, served by tests/e2e/server.ts.
 *   ?virtual=1  unmount rows more than ~2 viewports away (host-style virtualiser)
 *   ?stream=1   the last assistant reply streams for STREAM_MS, then completes
 *   ?stream=cut the last reply streams briefly, then stalls with its marker still set
 *   window.__ppEvict(k)  drop the k oldest turns, as a host does before re-fetching them on demand
 *   window.__ppGo(path, html)  SPA thread switch via history.pushState (no page load); the test
 *                              supplies the next page's HTML so this page makes no requests
 */
(() => {
  const ROW_PX = 120;
  const KEEP_ROWS = 14;
  const STREAM_MS = 1500;
  const TICK_MS = 80;
  const params = new URLSearchParams(location.search);

  function virtualise() {
    const scroller = document.querySelector('[data-e2e-scroll]');
    const rowsEl = document.querySelector('[data-e2e-rows]');
    if (!scroller || !rowsEl) return;
    const rows = [...rowsEl.children].filter((c) => c.hasAttribute('data-e2e-row'));
    for (const r of rows) r.style.cssText = `height:${ROW_PX}px;overflow:hidden;box-sizing:border-box`;
    const top = document.createElement('div');
    const bottom = document.createElement('div');
    let frame = 0;
    const render = () => {
      frame = 0;
      const center = Math.floor((scroller.scrollTop + scroller.clientHeight / 2) / ROW_PX);
      const first = Math.max(0, center - KEEP_ROWS);
      const last = Math.min(rows.length, center + KEEP_ROWS);
      top.style.height = `${first * ROW_PX}px`;
      bottom.style.height = `${(rows.length - last) * ROW_PX}px`;
      rowsEl.replaceChildren(top, ...rows.slice(first, last), bottom);
    };
    scroller.addEventListener('scroll', () => {
      frame ||= requestAnimationFrame(render);
    });
    window.__ppEvict = (k) => {
      rows.splice(0, k);
      render();
    };
    render();
  }

  function el(tag, attrs) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  function actionRow(tag, attrs, labels) {
    const row = el(tag, attrs);
    for (const label of labels) row.append(el('button', { 'aria-label': label }));
    return row;
  }

  function stream(mode) {
    const host = location.pathname.split('/')[1];
    const assistants = document.querySelectorAll(
      '[data-message-author-role="assistant"], [data-testid="assistant-message"], model-response',
    );
    const tail = assistants[assistants.length - 1];
    const p = tail && tail.querySelector('p');
    if (!p) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      if (mode === 'cut' && elapsed > STREAM_MS / 3) {
        clearInterval(timer); // connection lost: no more tokens, marker stays set
        return;
      }
      if (elapsed < STREAM_MS) {
        p.append(' token');
        return;
      }
      clearInterval(timer);
      // Completion as the hosts do it: clear the streaming marker, then render the action row.
      if (host === 'claude') {
        tail.setAttribute('data-is-streaming', 'false');
        tail.after(actionRow('div', { 'data-testid': 'message-actions', class: 'actions' }, ['Copy', 'Retry', 'Good response']));
      }
      if (host === 'gemini') {
        tail.querySelector('[aria-busy]')?.removeAttribute('aria-busy');
        const outer = el('message-actions', { class: 'message-actions' });
        const inner = el('div', { class: 'actions-container-v2' });
        inner.append(actionRow('div', { class: 'buttons-container-v2' }, ['Good response', 'Bad response', 'Copy', 'More']));
        outer.append(inner);
        tail.append(outer);
      }
      if (host === 'chatgpt') {
        document.querySelector('[data-testid="stop-button"]')?.setAttribute('data-testid', 'send-button');
        tail.querySelector('.result-streaming')?.classList.remove('result-streaming');
        const row = actionRow('div', { class: 'turn-actions', role: 'group', 'aria-label': 'Response actions' }, ['Copy', 'Good response', 'Bad response']);
        tail.closest('section')?.append(row);
      }
      document.dispatchEvent(new CustomEvent('e2e:stream-done'));
    }, TICK_MS);
  }

  function init() {
    if (params.get('virtual') === '1') virtualise();
    const s = params.get('stream');
    if (s) stream(s);
  }

  window.__ppGo = (path, html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    history.pushState(null, '', path);
    document.title = doc.title;
    document.body.replaceChildren(...[...doc.body.childNodes].filter((n) => n.nodeName !== 'SCRIPT'));
    init();
  };

  init();
})();
