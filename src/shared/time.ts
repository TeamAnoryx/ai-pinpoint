/**
 * Relative time for pin cards and thread rows (UI_SPEC.md §4): "just now", "4m", "2h", "3d",
 * then "DD MMM". No date library (TECH_STACK.md §4).
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
}

/** Absolute local time for `title` attributes. */
export function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString();
}
