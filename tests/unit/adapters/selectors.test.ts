import { createSelectorSet, t1, t2, t3, t4 } from '@content/adapters/selectors';

function html(markup: string): HTMLElement {
  const host = document.createElement('div');
  host.append(document.createRange().createContextualFragment(markup));
  document.body.append(host);
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
});

const spec = {
  main: { tiers: [t1('[role="main"]'), t4('[class*="chat-window"]')] },
  message: {
    tiers: [
      t2('[data-msg]'),
      t3((root) => [...root.querySelectorAll('section')].filter((s) => s.children.length > 1)),
      t4('[class*="bubble"]'),
    ],
  },
  broken: { tiers: [t2('[[nope'), t4('.fallback')] },
};

describe('createSelectorSet', () => {
  test('resolves at the highest tier that matches and records it', () => {
    const root = html('<div role="main"></div><div class="x-chat-window"></div>');
    const set = createSelectorSet('test', spec);
    expect(set.one('main', root)?.getAttribute('role')).toBe('main');
    expect(set.tierOf('main')).toBe(1);
  });

  test('falls through to a lower tier when higher tiers miss', () => {
    const root = html('<div class="a bubble-1"></div><div class="bubble-2"></div>');
    const set = createSelectorSet('test', spec);
    expect(set.all('message', root)).toHaveLength(2);
    expect(set.tierOf('message')).toBe(4);
  });

  test('runs structural predicates at tier 3', () => {
    const root = html('<section><p>a</p><p>b</p></section><section><p>c</p></section>');
    const set = createSelectorSet('test', spec);
    expect(set.all('message', root)).toHaveLength(1);
    expect(set.tierOf('message')).toBe(3);
  });

  test('skips an invalid selector instead of throwing', () => {
    const root = html('<i class="fallback"></i>');
    const set = createSelectorSet('test', spec);
    expect(set.one('broken', root)?.className).toBe('fallback');
    expect(set.tierOf('broken')).toBe(4);
  });

  test('reports null for keys that missed or never ran', () => {
    const root = html('<p>nothing</p>');
    const set = createSelectorSet('test', spec);
    expect(set.one('main', root)).toBeNull();
    expect(set.report()).toEqual({ main: null, message: null, broken: null });
  });

  test('updates the recorded tier when the DOM changes', () => {
    const root = html('<div class="bubble"></div>');
    const set = createSelectorSet('test', spec);
    set.all('message', root);
    expect(set.tierOf('message')).toBe(4);
    const tagged = document.createElement('div');
    tagged.setAttribute('data-msg', '1');
    root.append(tagged);
    set.all('message', root);
    expect(set.tierOf('message')).toBe(2);
  });
});
