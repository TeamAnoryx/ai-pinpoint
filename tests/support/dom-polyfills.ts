/** jsdom lacks layout-driven APIs the content script uses; minimal stand-ins for tests. */
const g = globalThis as Record<string, unknown>;
g['requestAnimationFrame'] ??= (cb: FrameRequestCallback): number =>
  setTimeout(() => cb(performance.now()), 0) as unknown as number;
g['cancelAnimationFrame'] ??= (id: number): void => clearTimeout(id);

export const scrolledIntoView: Element[] = [];
Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
  scrolledIntoView.push(this);
};
