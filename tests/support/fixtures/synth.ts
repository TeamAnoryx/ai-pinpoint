/**
 * Synthetic host fixtures (ADAPTERS.md §9). Structure mirrors the live-host survey in
 * docs/DECISIONS.md D-011; every word of text is generated placeholder, never a real
 * conversation. `pnpm fixture:capture --synth` writes these to tests/fixtures/<host>/.
 */

export type FixtureHost = 'gemini' | 'chatgpt' | 'claude';
export type Role = 'user' | 'assistant';

export interface FixtureMessage {
  role: Role;
  nativeId: string;
  /** Expected normalised getText() output. */
  text: string;
  para: string;
  code: string | null;
}

export interface FixtureVariant {
  messages?: number;
  streaming?: boolean;
  scrambled?: boolean;
  noActions?: boolean;
  branched?: boolean;
  artifact?: boolean;
  immersive?: boolean;
}

export interface Fixture {
  host: FixtureHost;
  name: string;
  /** Path the fixture is "served" at; tests pushState to it. */
  path: string;
  threadId: string;
  title: string;
  html: string;
  messages: FixtureMessage[];
  streamingIndex: number | null;
  hasActionRows: boolean;
  /** Scroll container is tall enough to scroll (long-thread). */
  scrolls: boolean;
}

const WORDS = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet',
  'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango',
  'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu',
];

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function words(seed: number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[(seed * 7 + i * 11) % WORDS.length]!);
  return out.join(' ');
}

function hex(seed: number, len: number): string {
  let s = '';
  let x = (seed + 1) * 2654435761;
  while (s.length < len) {
    x = (x ^ (x >>> 13)) * 1274126177;
    s += (x >>> 0).toString(16).padStart(8, '0');
  }
  return s.slice(0, len);
}

const uuid = (seed: number): string => {
  const h = hex(seed, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><title>icon</title><path d="M0 0h24v24H0z"></path></svg>';
const btn = (label: string, extra = ''): string => `<button aria-label="${label}" ${extra}>${SVG}</button>`;

function messagesFor(count: number, idOf: (i: number, role: Role) => string, lang: string): FixtureMessage[] {
  const out: FixtureMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role: Role = i % 2 === 0 ? 'user' : 'assistant';
    const para = `Fixture ${role} message ${i} ${words(i, 6 + (i % 5))}.`;
    const code = role === 'assistant' && i % 3 === 1 ? `print(${i})` : null;
    const text = code ? `${para} ${lang} ${code}` : para;
    out.push({ role, nativeId: idOf(i, role), text, para, code });
  }
  return out;
}

function scramble(html: string): string {
  let n = 0;
  return html.replace(/class="[^"]*"/g, () => `class="x${hex(n++, 6)} y${hex(n * 31, 4)}"`);
}

function page(title: string, body: string): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>\n${body}\n</body></html>\n`;
}

const SCROLL_STYLE = 'overflow-y:auto;height:800px';

// ---------------------------------------------------------------- Gemini

function gemini(name: string, v: FixtureVariant): Fixture {
  const count = v.messages ?? 4;
  const turnId = (i: number): string => hex(Math.floor(i / 2) + 100, 16);
  const msgs = messagesFor(count, (i, role) => `${turnId(i)}:${role}`, 'Python');
  const last = msgs.length - 1;
  const turns: string[] = [];
  for (let i = 0; i < msgs.length; i += 2) {
    const u = msgs[i]!;
    const a = msgs[i + 1];
    const userActions = v.noActions
      ? ''
      : `<div class="luminous-actions-container">${btn('Copy prompt')}${btn('Edit')}</div>`;
    const user = `<user-query class="user-query"><div class="query-content"><h5 class="cdk-visually-hidden">You said</h5><div class="query-text"><p class="query-text-line">${esc(u.para)}</p></div></div>${userActions}</user-query>`;
    let model = '';
    if (a) {
      const streaming = v.streaming === true && i + 1 === last;
      const code = a.code
        ? `<code-block class="code-block"><div class="code-block-decoration"><span>Python</span>${btn('Copy code')}${btn('Download')}</div><pre><code>${esc(a.code)}</code></pre></code-block>`
        : '';
      const actions =
        v.noActions || streaming
          ? ''
          : `<message-actions class="message-actions"><div class="actions-container-v2"><div class="buttons-container-v2">${btn('Good response')}${btn('Bad response')}${btn('Copy')}${btn('More')}</div></div></message-actions>`;
      model = `<model-response class="model-response"><div class="response-container"><h6 class="cdk-visually-hidden">Gemini said</h6><model-thoughts class="model-thoughts"><button aria-expanded="false">Show thinking</button></model-thoughts><message-content id="message-content-id-r_${turnId(i)}" class="model-response-text"${streaming ? ' aria-busy="true"' : ''}><div class="markdown"><p>${esc(a.para)}</p>${code}</div></message-content><sources-list class="sources-list"><a href="#s">Source chip</a></sources-list></div>${actions}</model-response>`;
    }
    turns.push(`<div class="conversation-container" id="${turnId(i)}">${user}${model}</div>`);
  }
  const panel = v.immersive
    ? `<immersive-panel class="immersive-panel"><h2>Canvas panel</h2><p>Side panel body text</p>${btn('Close')}${btn('Share')}</immersive-panel>`
    : '';
  let body = `<bard-sidenav><nav class="side-nav"><a class="conversation selected" href="/app/aaaa">Fixture thread</a><a class="conversation" href="/app/bbbb">Other thread</a></nav></bard-sidenav>
<main class="main-content"><chat-window class="chat-window"><div class="chat-container">
<infinite-scroller data-test-id="chat-history-container" class="chat-history" style="${SCROLL_STYLE}">
${turns.join('\n')}
</infinite-scroller>
<input-area-v2 class="input-area"><rich-textarea><div contenteditable="true" role="textbox"></div></rich-textarea>${btn('Send message', 'class="send-button"')}${btn('Microphone')}</input-area-v2>
</div></chat-window>${panel}</main>`;
  if (v.scrambled) body = scramble(body);
  const id = 'c0ffee12ab34cd56';
  return {
    host: 'gemini',
    name,
    path: `/app/${id}`,
    threadId: `gemini:${id}`,
    title: 'Fixture thread',
    html: page('Fixture thread - Google Gemini', body),
    messages: msgs,
    streamingIndex: v.streaming ? last : null,
    hasActionRows: !v.noActions,
    scrolls: count > 20,
  };
}

// ---------------------------------------------------------------- ChatGPT

function chatgpt(name: string, v: FixtureVariant): Fixture {
  const count = v.messages ?? 4;
  const msgs = messagesFor(count, (i) => uuid(i + 500), 'python');
  const last = msgs.length - 1;
  const turns = msgs.map((m, i) => {
    const streaming = v.streaming === true && i === last;
    const label = m.role === 'user' ? 'You said:' : 'ChatGPT said:';
    const inner =
      m.role === 'user'
        ? `<div class="whitespace-pre-wrap">${esc(m.para)}</div>`
        : `<div class="markdown prose${streaming ? ' result-streaming' : ''}"><p>${esc(m.para)}</p>${
            m.code
              ? `<pre><div class="code-header"><span>python</span>${btn('Copy code')}</div><code>${esc(m.code)}</code></pre>`
              : ''
          }</div>`;
    const branch = v.branched && i === 2 ? `${btn('Previous response')}<div class="tabular-nums">2/3</div>${btn('Next response')}` : '';
    const actions =
      v.noActions || streaming
        ? ''
        : m.role === 'user'
          ? `<div class="turn-actions" role="group" aria-label="Message actions">${btn('Copy', 'data-testid="copy-turn-action-button"')}${btn('Edit message')}${branch}</div>`
          : `<div class="turn-actions" role="group" aria-label="Response actions">${btn('Copy', 'data-testid="copy-turn-action-button"')}${btn('Good response')}${btn('Bad response')}${btn('Share')}${btn('Try again')}</div>`;
    return `<section data-testid="conversation-turn-${i + 1}" data-turn="${m.role}" data-turn-id="${hex(i + 900, 12)}" class="turn"><h4 class="sr-only">${label}</h4><div class="msg-wrap"><div data-message-author-role="${m.role}" data-message-id="${m.nativeId}" class="min-h-8">${inner}</div></div>${actions}</section>`;
  });
  const composerBtn = v.streaming ? btn('Stop streaming', 'data-testid="stop-button"') : btn('Send prompt', 'data-testid="send-button"');
  let body = `<nav aria-label="Chat history" class="sidebar"><a href="/c/other">Other chat</a></nav>
<div class="scroll-root" style="${SCROLL_STYLE}"><main id="main" class="relative">
<div id="thread" class="thread">
${turns.join('\n')}
</div>
<form class="composer"><div id="prompt-textarea" contenteditable="true"></div>${composerBtn}</form>
</main></div>`;
  if (v.scrambled) body = scramble(body);
  const id = uuid(7);
  return {
    host: 'chatgpt',
    name,
    path: `/c/${id}`,
    threadId: `chatgpt:${id}`,
    title: 'Fixture thread',
    html: page('Fixture thread', body),
    messages: msgs,
    streamingIndex: v.streaming ? last : null,
    hasActionRows: !v.noActions,
    scrolls: count > 20,
  };
}

// ---------------------------------------------------------------- Claude

function claude(name: string, v: FixtureVariant): Fixture {
  const count = v.messages ?? 4;
  const msgs = messagesFor(count, (i, role) => (role === 'user' ? uuid(i + 300) : `${uuid(i + 299)}-hub-reply`), 'python');
  const last = msgs.length - 1;
  const rows = msgs.map((m, i) => {
    const streaming = v.streaming === true && i === last;
    let article: string;
    if (m.role === 'user') {
      const actions = v.noActions ? '' : `<div class="user-actions">${btn('Edit')}${btn('Copy')}</div>`;
      article = `<h2 data-find-omitted="true" class="sr-only">You said:</h2><div class="bubble"><div data-testid="user-message" class="font-user-message"><p class="whitespace-pre-wrap">${esc(m.para)}</p></div></div>${actions}`;
    } else {
      const thinking =
        v.artifact && i === 1
          ? `<div class="thinking-block"><div class="thinking-header"><button aria-expanded="false" aria-label="Thought process">Thought process</button></div></div>`
          : '';
      const artifact =
        v.artifact && i === 1
          ? `<div data-sheet-kind="artifact" class="artifact-card"><button data-testid="file-card-open"><span>Fixture artifact</span><span>Code · PY</span></button></div>`
          : '';
      const code = m.code
        ? `<pre><div class="code-header">python${btn('Copy')}</div><code>${esc(m.code)}</code></pre>`
        : '';
      const actions =
        v.noActions || streaming ? '' : `<div data-testid="message-actions" class="actions">${btn('Copy')}${btn('Retry')}${btn('Good response')}</div>`;
      article = `<h2 data-find-omitted="true" class="sr-only">Claude said:</h2><div data-testid="assistant-message" data-is-streaming="${streaming}" class="font-claude-message">${thinking}<div class="prose"><p>${esc(m.para)}</p>${code}</div>${artifact}</div>${actions}`;
    }
    return `<div data-testid="transcript-row" data-index="${i}" class="row"><div role="article" data-turn-key="${m.nativeId}" class="group">${article}</div></div>`;
  });
  let body = `<nav aria-label="Sidebar" class="sidebar"><a href="/chat/other">Other chat</a></nav>
<div data-autoscroll-container="true" class="overflow-y-auto" style="${SCROLL_STYLE}">
<div data-testid="transcript-list" class="mx-auto"><div data-testid="transcript-sizer" class="sizer"><div data-testid="transcript-spacer" class="spacer"></div>
${rows.join('\n')}
</div></div>
<fieldset class="composer"><div contenteditable="true" role="textbox"></div>${btn('Send message')}</fieldset>
</div>`;
  if (v.scrambled) body = scramble(body);
  const id = uuid(11);
  return {
    host: 'claude',
    name,
    path: `/chat/${id}`,
    threadId: `claude:${id}`,
    title: 'Fixture thread',
    html: page('Fixture thread - Claude', body),
    messages: msgs,
    streamingIndex: v.streaming ? last : null,
    hasActionRows: !v.noActions,
    scrolls: count > 20,
  };
}

const BUILDERS: Record<FixtureHost, (name: string, v: FixtureVariant) => Fixture> = { gemini, chatgpt, claude };

const COMMON: Record<string, FixtureVariant> = {
  'short-thread': {},
  'long-thread': { messages: 120 },
  streaming: { streaming: true },
  'scrambled-classes': { scrambled: true },
  'no-action-rows': { noActions: true },
};

const EXTRA: Record<FixtureHost, Record<string, FixtureVariant>> = {
  gemini: { immersive: { immersive: true } },
  chatgpt: { branched: { messages: 6, branched: true } },
  claude: { artifact: { artifact: true } },
};

export function allFixtures(): Fixture[] {
  return (Object.keys(BUILDERS) as FixtureHost[]).flatMap((host) =>
    Object.entries({ ...COMMON, ...EXTRA[host] }).map(([name, v]) => BUILDERS[host](name, v)),
  );
}

export function fixture(host: FixtureHost, name: string): Fixture {
  const found = allFixtures().find((f) => f.host === host && f.name === name);
  if (!found) throw new Error(`no fixture ${host}/${name}`);
  return found;
}
