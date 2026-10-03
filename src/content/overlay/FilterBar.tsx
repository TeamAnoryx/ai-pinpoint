/** Live substring filter for the "This chat" list (UI_SPEC.md §8). Esc clears. */
import { useEffect, useRef } from 'preact/hooks';
import { useOverlay } from './context';
import { Icon } from './icons';

export function FilterBar({ resultCount }: { resultCount: number }) {
  const { model } = useOverlay();
  const input = useRef<HTMLInputElement>(null);
  const tick = model.engine.value.focusFilterTick;

  useEffect(() => {
    if (tick > 0) input.current?.focus();
  }, [tick]);

  return (
    <div class="pp-filter">
      <Icon name="search" />
      <input
        ref={input}
        type="search"
        placeholder="Filter pins"
        aria-label="Filter pins"
        value={model.filter.value}
        onInput={(e) => (model.filter.value = (e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && model.filter.value) {
            e.stopPropagation();
            model.filter.value = '';
          }
        }}
      />
      {model.filter.value && (
        <span class="pp-results" aria-live="polite">
          {resultCount} {resultCount === 1 ? 'result' : 'results'}
        </span>
      )}
    </div>
  );
}
