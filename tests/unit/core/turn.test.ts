import { turnOf } from '@content/core/turn';

type Role = 'user' | 'assistant' | 'unknown';
function nodes(roles: Role[]): { list: HTMLElement[]; roleOf: (n: HTMLElement) => Role } {
  const list = roles.map((r, i) => {
    const el = document.createElement('div');
    el.dataset['i'] = String(i);
    el.dataset['role'] = r;
    return el;
  });
  return { list, roleOf: (n) => n.dataset['role'] as Role };
}
const idx = (els: readonly HTMLElement[]): number[] => els.map((e) => Number(e.dataset['i']));

describe('turnOf', () => {
  const { list, roleOf } = nodes(['user', 'assistant', 'user', 'assistant', 'assistant', 'user', 'assistant']);

  test('a prompt spans to the last reply before the next prompt', () => {
    expect(idx(turnOf(list, list[0]!, roleOf))).toEqual([0, 1]);
    expect(idx(turnOf(list, list[2]!, roleOf))).toEqual([2, 3, 4]);
  });

  test('a reply resolves to its whole turn, prompt included', () => {
    expect(idx(turnOf(list, list[4]!, roleOf))).toEqual([2, 3, 4]);
    expect(idx(turnOf(list, list[6]!, roleOf))).toEqual([5, 6]);
  });

  test('replies before any prompt (virtualised top) group from the first node', () => {
    const v = nodes(['assistant', 'assistant', 'user', 'assistant']);
    expect(idx(turnOf(v.list, v.list[1]!, v.roleOf))).toEqual([0, 1]);
  });

  test('a node not in the list, or unknown roles, fall back to the node alone', () => {
    const stray = document.createElement('div');
    expect(turnOf(list, stray, roleOf)).toEqual([stray]);
    const u = nodes(['unknown', 'unknown', 'unknown']);
    expect(idx(turnOf(u.list, u.list[1]!, u.roleOf))).toEqual([1]);
  });
});
