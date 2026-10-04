/**
 * Inline SVG icons (UI_SPEC.md §3): 16×16 viewBox, currentColor, 1.5px stroke. Preact builds
 * SVG with createElementNS, so nothing here touches innerHTML (EDGE_CASES.md §20).
 */
const PATHS = {
  pin: 'M9.5 2.5l4 4-2 1-2.5 2.5.5 3-1.5 1.5-2.5-2.5-3.5 3.5-.5-.5 3.5-3.5L2 8.5 3.5 7l3 .5L9 5z',
  'chevron-left': 'M10 3L5 8l5 5',
  'chevron-right': 'M6 3l5 5-5 5',
  search: 'M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11 11l3.5 3.5',
  x: 'M4 4l8 8M12 4l-8 8',
  pencil: 'M10.5 2.5l3 3L6 13H3v-3z',
  copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
  'drag-handle': 'M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9',
  download: 'M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10',
  upload: 'M8 10.5v-8M4.5 6L8 2.5 11.5 6M3 13.5h10',
  'alert-triangle': 'M8 2L14.5 13.5h-13zM8 6.5v3M8 11.5h.01',
  undo: 'M5.5 3.5L2.5 6.5l3 3M2.5 6.5H10a3.5 3.5 0 010 7H7',
  'external-link': 'M9.5 2.5h4v4M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4',
  settings: 'M8 10a2 2 0 100-4 2 2 0 000 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
} as const;

export type IconName = keyof typeof PATHS | 'pin-filled';

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = name === 'pin-filled';
  const d = PATHS[filled ? 'pin' : name];
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
