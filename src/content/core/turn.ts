/**
 * A conversational turn: a user prompt plus every reply after it, up to the next prompt
 * (D-022). Used to highlight the whole exchange a pin belongs to.
 */
export type RoleOf = (node: HTMLElement) => 'user' | 'assistant' | 'unknown';

export function turnOf(nodes: readonly HTMLElement[], node: HTMLElement, roleOf: RoleOf): HTMLElement[] {
  const i = nodes.indexOf(node);
  if (i < 0 || roleOf(node) === 'unknown') return [node];
  let start = i;
  // Walk back to the prompt; with none above (virtualised away) the turn starts at the top.
  while (start > 0 && roleOf(nodes[start]!) !== 'user') start--;
  let end = i;
  while (end + 1 < nodes.length && roleOf(nodes[end + 1]!) !== 'user') end++;
  return nodes.slice(start, end + 1);
}
