import { STREAM_SAMPLE_MS, STREAM_TIMEOUT_MS } from '@shared/constants';
import {
  createStreamSampler,
  deepQueryAll,
  extractText,
  findButtonRow,
  findScrollableAncestor,
  normaliseText,
} from '@content/adapters/dom-utils';

function html(markup: string): HTMLElement {
  const host = document.createElement('div');
  // Test-only fixture parsing; production code never parses HTML strings (R5).
  host.append(document.createRange().createContextualFragment(markup));
  document.body.append(host);
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('deepQueryAll', () => {
  test('finds matches in the light DOM and in open shadow roots', () => {
    const root = html('<p class="m">a</p><div id="host"></div>');
    const shadow = root.querySelector('#host')!.attachShadow({ mode: 'open' });
    const inner = document.createElement('p');
    inner.className = 'm';
    shadow.append(inner);
    expect(deepQueryAll(root, '.m')).toHaveLength(2);
  });

  test('never pierces closed shadow roots', () => {
    const root = html('<div id="host"></div>');
    const shadow = root.querySelector('#host')!.attachShadow({ mode: 'closed' });
    const inner = document.createElement('p');
    inner.className = 'm';
    shadow.append(inner);
    expect(deepQueryAll(root, '.m')).toEqual([]);
  });
});

describe('findScrollableAncestor', () => {
  function sized(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight });
    Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  }

  test('returns the nearest ancestor that overflows and scrolls', () => {
    const root = html(
      '<div id="outer" style="overflow-y:auto"><div id="inner" style="overflow-y:scroll"><p id="leaf">x</p></div></div>',
    );
    sized(root.querySelector<HTMLElement>('#outer')!, 2000, 500);
    sized(root.querySelector<HTMLElement>('#inner')!, 1000, 500);
    expect(findScrollableAncestor(root.querySelector<HTMLElement>('#leaf')!)?.id).toBe('inner');
  });

  test('skips ancestors that would scroll but do not overflow enough', () => {
    const root = html('<div id="a" style="overflow-y:auto"><p id="leaf">x</p></div>');
    sized(root.querySelector<HTMLElement>('#a')!, 510, 500);
    expect(findScrollableAncestor(root.querySelector<HTMLElement>('#leaf')!)).toBe(
      document.scrollingElement ?? document.documentElement,
    );
  });
});

describe('normaliseText', () => {
  test('strips invisible characters, collapses whitespace, and drops trailing action labels', () => {
    expect(normaliseText('  Hello​   world \n\n Copy  Edit ')).toBe('Hello world');
  });

  test('keeps action words that are part of the message', () => {
    expect(normaliseText('Please copy the file')).toBe('Please copy the file');
  });
});

describe('extractText', () => {
  test('removes buttons, icons, hidden nodes, our own UI, and adapter exclusions', () => {
    const root = html(
      '<div id="m"><p>Keep this</p><button>Copy</button><svg><text>icon</text></svg>' +
        '<span aria-hidden="true">x</span><span data-pinpoint-btn>pin</span>' +
        '<details class="thinking"><p>reasoning</p></details><p>and this</p></div>',
    );
    const text = extractText(root.querySelector<HTMLElement>('#m')!, ['.thinking']);
    expect(text).toBe('Keep this and this');
  });

  test('does not mutate the live node', () => {
    const root = html('<div id="m"><p>a</p><button>b</button></div>');
    const node = root.querySelector<HTMLElement>('#m')!;
    extractText(node);
    expect(node.querySelector('button')).not.toBeNull();
  });

  test('separates block elements so words do not run together', () => {
    const root = html('<div id="m"><p>one</p><p>two</p><ul><li>three</li></ul></div>');
    expect(extractText(root.querySelector<HTMLElement>('#m')!)).toBe('one two three');
  });

  test('tolerates a malformed exclusion selector', () => {
    const root = html('<div id="m"><p>a</p></div>');
    expect(extractText(root.querySelector<HTMLElement>('#m')!, ['[[bad'])).toBe('a');
  });
});

describe('findButtonRow', () => {
  test('picks the deepest element holding the action buttons', () => {
    const root = html(
      '<div id="m"><p>message body text</p><div id="bar"><div id="row"><button>c</button><button>d</button></div></div></div>',
    );
    expect(findButtonRow(root.querySelector<HTMLElement>('#m')!)?.id).toBe('row');
  });

  test('ignores code-block toolbars and caller-supplied regions', () => {
    const root = html(
      '<div id="m"><pre><div><button>copy</button><button>wrap</button></div></pre>' +
        '<div class="artifact"><button>open</button><button>dl</button></div><p>text</p></div>',
    );
    expect(findButtonRow(root.querySelector<HTMLElement>('#m')!, ['.artifact'])).toBeNull();
  });

  test('rejects containers that hold real text', () => {
    const root = html(
      '<div id="m"><div id="c">A long paragraph of real words<button>a</button><button>b</button></div></div>',
    );
    expect(findButtonRow(root.querySelector<HTMLElement>('#m')!)).toBeNull();
  });

  test('accepts a branch counter label inside the row', () => {
    const root = html(
      '<div id="m"><p>body</p><div id="row"><button>‹</button><span>2 / 3</span><button>›</button></div></div>',
    );
    expect(findButtonRow(root.querySelector<HTMLElement>('#m')!)?.id).toBe('row');
  });

  test('does not count our own injected button', () => {
    const root = html(
      '<div id="m"><div id="row"><button>c</button><span data-pinpoint-btn><button>pin</button></span></div></div>',
    );
    expect(findButtonRow(root.querySelector<HTMLElement>('#m')!)).toBeNull();
  });
});

describe('createStreamSampler', () => {
  test('streams until two samples apart see the same length', () => {
    let t = 0;
    const isStreaming = createStreamSampler(() => t);
    const node = document.createElement('div');
    expect(isStreaming(node, 10)).toBe(true);
    t += STREAM_SAMPLE_MS - 1;
    expect(isStreaming(node, 10)).toBe(true);
    t += 1;
    expect(isStreaming(node, 20)).toBe(true);
    t += STREAM_SAMPLE_MS;
    expect(isStreaming(node, 20)).toBe(false);
  });

  test('treats a node as finished after the timeout even if it keeps changing', () => {
    let t = 0;
    const isStreaming = createStreamSampler(() => t);
    const node = document.createElement('div');
    isStreaming(node, 1);
    t = STREAM_TIMEOUT_MS;
    expect(isStreaming(node, 999)).toBe(false);
  });
});
