/**
 * Pin card (UI_SPEC.md §4). A `listitem` holding a full-width navigate button plus a separate
 * menu button, so no interactive element nests inside another. Snippets render as text only.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LABEL_COUNTER_FROM, MAX_LABEL_CHARS } from '@shared/constants';
import { formatAbsolute, formatRelative } from '@shared/time';
import type { PinView } from '@content/core/state';
import { useOverlay } from './context';
import { Icon } from './icons';

const ROLE_LABEL = { user: 'User', assistant: 'AI', unknown: 'Msg' } as const;
const CODE_START = /^\s*(?:`|import\s|const\s|let\s|function\s|def\s|class\s|#include|SELECT\s)/i;

const NOT_FOUND_COPY: Record<string, string> = {
  branch: 'May be on a different edit branch — retry',
  'not-loaded': "This part of the chat isn't loaded — retry",
};

export interface PinCardProps {
  view: PinView;
  index: number;
  total: number;
  /** Move keyboard focus to another card (index), clamped by the list. */
  focusCard(index: number): void;
  onDragStart(pinId: string, e: PointerEvent): void;
  dragging: boolean;
}

export function PinCard({ view, index, total, focusCard, onDragStart, dragging }: PinCardProps) {
  const { model, intents } = useOverlay();
  const { pin } = view;
  const editing = model.editing.value === pin.pinId;
  const menuOpen = model.menu.value === pin.pinId;
  const [draft, setDraft] = useState(pin.label ?? '');
  const input = useRef<HTMLInputElement>(null);
  const menuFirst = useRef<HTMLButtonElement>(null);
  /** Enter/Escape and the following blur must not both commit. */
  const settled = useRef(false);
  const primary = pin.label ?? pin.snippet;

  // Layout effect: focus before the next key event so no keystroke after F2 is lost.
  useLayoutEffect(() => {
    if (editing) {
      settled.current = false;
      setDraft(pin.label ?? '');
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (menuOpen) menuFirst.current?.focus();
  }, [menuOpen]);

  const startEdit = (): void => {
    model.menu.value = null;
    model.editing.value = pin.pinId;
  };
  const finishEdit = (save: boolean): void => {
    if (settled.current) return;
    settled.current = true;
    // Read the live input: a keystroke's state update may not have rendered yet.
    const value = input.current?.value ?? draft;
    model.editing.value = null;
    if (save) void intents.rename(pin.pinId, value.trim() || null);
    focusCard(index);
  };
  const move = (delta: number): void => {
    const ids = model.engine.value.pins.map((p) => p.pin.pinId);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(index, 1);
    next.splice(to, 0, pin.pinId);
    void intents.reorder(next);
    focusCard(to);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusCard(Math.max(0, Math.min(total - 1, index + (e.key === 'ArrowUp' ? -1 : 1))));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusCard(e.key === 'Home' ? 0 : total - 1);
    } else if (e.key === 'F2') {
      e.preventDefault();
      startEdit();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void intents.unpin(pin.pinId);
      focusCard(Math.min(index, total - 2));
    }
  };

  const closeMenu = (refocus: boolean): void => {
    model.menu.value = null;
    if (refocus) focusCard(index);
  };

  return (
    <li class="pp-card" role="listitem" data-nav={view.nav} data-dragging={String(dragging)} data-pin-id={pin.pinId}>
      <span class="pp-drag" aria-hidden="true" onPointerDown={(e) => onDragStart(pin.pinId, e)}>
        <Icon name="drag-handle" />
      </span>
      <button
        type="button"
        class="pp-card-main"
        data-card-index={index}
        aria-label={`${ROLE_LABEL[pin.role]} message, ${primary}`}
        onClick={() => void intents.navigate(pin.pinId)}
        onKeyDown={onKeyDown}
      >
        <span class="pp-meta">
          <span class="pp-role" data-role={pin.role} data-in-view={String(view.inView)}>
            {ROLE_LABEL[pin.role]}
          </span>
          {view.duplicate && (
            <span title="another message has identical text" aria-label="duplicate text">
              ⧉
            </span>
          )}
          {view.nav === 'locating' ? (
            <>
              <span class="pp-spinner" aria-hidden="true" />
              <span>locating…</span>
            </>
          ) : (
            <span title={formatAbsolute(pin.createdAt)}>{formatRelative(pin.createdAt, model.now.value)}</span>
          )}
        </span>
        {!editing && (
          <span class="pp-primary" data-code={String(pin.label === null && CODE_START.test(pin.snippet))}>
            {primary}
          </span>
        )}
        {!editing && pin.label !== null && <span class="pp-secondary">{pin.snippet}</span>}
      </button>
      {editing && (
        <div style={{ padding: '0 12px 10px 28px' }}>
          <input
            ref={input}
            class="pp-edit"
            aria-label="Pin label"
            maxLength={MAX_LABEL_CHARS}
            value={draft}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishEdit(true);
              if (e.key === 'Escape') {
                e.stopPropagation();
                finishEdit(false);
              }
            }}
            onBlur={() => finishEdit(true)}
          />
          {draft.length > LABEL_COUNTER_FROM && (
            <div class="pp-counter">
              {draft.length}/{MAX_LABEL_CHARS}
            </div>
          )}
        </div>
      )}
      {view.nav === 'not-found' && (
        <div style={{ padding: '0 12px 8px 28px' }}>
          <button type="button" class="pp-retry" onClick={() => void intents.navigate(pin.pinId)}>
            {NOT_FOUND_COPY[view.notFoundReason ?? ''] ?? "Couldn't find — retry"}
          </button>
        </div>
      )}
      <button
        type="button"
        class="pp-icon-btn pp-menu-btn"
        aria-label="Pin actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => (model.menu.value = menuOpen ? null : pin.pinId)}
      >
        <Icon name="more" />
      </button>
      {menuOpen && (
        <div
          class="pp-popover"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeMenu(true);
            }
          }}
        >
          <button ref={menuFirst} type="button" role="menuitem" onClick={startEdit}>
            <Icon name="pencil" /> Edit label
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu(true);
              void intents.copyText(pin.snippet);
            }}
          >
            <Icon name="copy" /> Copy snippet
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu(false);
              void intents.unpin(pin.pinId);
            }}
          >
            <Icon name="trash" /> Unpin
          </button>
        </div>
      )}
    </li>
  );
}
