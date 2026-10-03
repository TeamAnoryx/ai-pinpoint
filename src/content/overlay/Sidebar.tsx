/**
 * Expanded sidebar (UI_SPEC.md §2, §7–§8): header, tabs, banners, filter, pin list or thread
 * list, footer, resize strip, and pointer-driven drag reorder.
 */
import { Fragment } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { NARROW_VIEWPORT_PX, SIDEBAR_MARGIN_PX, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '@shared/constants';
import { useOverlay, type Tab } from './context';
import { FilterBar } from './FilterBar';
import { HealthBanner } from './HealthBanner';
import { Icon } from './icons';
import { PinCard } from './PinCard';
import { ThreadList } from './ThreadList';

const clampWidth = (w: number): number => Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(w)));

function Tabs() {
  const { model } = useOverlay();
  const tabs: { id: Tab; label: string }[] = [
    { id: 'chat', label: 'This chat' },
    { id: 'all', label: 'All chats' },
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div class="pp-tabs" role="tablist" aria-label="Pin views">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`pp-tab-${t.id}`}
          class="pp-tab"
          aria-selected={model.tab.value === t.id}
          aria-controls="pp-panel"
          tabIndex={model.tab.value === t.id ? 0 : -1}
          onClick={() => (model.tab.value = t.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next = tabs[(i + 1) % tabs.length]!;
            model.tab.value = next.id;
            refs.current[(i + 1) % tabs.length]?.focus();
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PinList() {
  const { model, intents } = useOverlay();
  const list = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ pinId: string; to: number } | null>(null);
  const all = model.engine.value.pins;
  const q = model.filter.value.trim().toLowerCase();
  const views = q
    ? all.filter((v) => `${v.pin.label ?? ''} ${v.pin.snippet}`.toLowerCase().includes(q))
    : all;

  const focusCard = (index: number): void => {
    requestAnimationFrame(() => {
      list.current?.querySelector<HTMLButtonElement>(`[data-card-index="${index}"]`)?.focus();
    });
  };

  const dropIndex = (clientY: number): number => {
    const cards = [...(list.current?.querySelectorAll<HTMLElement>('.pp-card') ?? [])];
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return clientY < r.top + r.height / 2;
    });
    return i < 0 ? cards.length : i;
  };

  const onDragStart = (pinId: string, e: PointerEvent): void => {
    if (q) return; // reordering a filtered subset would be ambiguous
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture?.(e.pointerId);
    setDrag({ pinId, to: dropIndex(e.clientY) });
    const move = (ev: PointerEvent): void => setDrag({ pinId, to: dropIndex(ev.clientY) });
    const up = (ev: PointerEvent): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const ids = all.map((v) => v.pin.pinId);
      const from = ids.indexOf(pinId);
      let to = dropIndex(ev.clientY);
      setDrag(null);
      if (ev.type === 'pointercancel' || from < 0) return;
      if (to > from) to--;
      if (to === from) return;
      ids.splice(from, 1);
      ids.splice(to, 0, pinId);
      void intents.reorder(ids);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  if (all.length === 0) {
    return (
      <div class="pp-empty" role="status">
        <Icon name="pin" size={24} />
        <p>No pins in this chat yet</p>
        <p style={{ fontSize: '12px' }}>
          Click the pin icon on any message, or press Alt+Shift+P to pin the last reply.
        </p>
      </div>
    );
  }
  return (
    <>
      <FilterBar resultCount={views.length} />
      <ul ref={list} class="pp-list" role="list" aria-label="Pinned messages">
        {views.map((v, i) => (
          <Fragment key={v.pin.pinId}>
            {drag && drag.to === i && <li class="pp-drop-line" aria-hidden="true" />}
            <PinCard
              view={v}
              index={i}
              total={views.length}
              focusCard={focusCard}
              onDragStart={onDragStart}
              dragging={drag?.pinId === v.pin.pinId}
            />
          </Fragment>
        ))}
        {drag && drag.to >= views.length && <li class="pp-drop-line" aria-hidden="true" />}
        {q && views.length === 0 && <li class="pp-empty">No pins match “{model.filter.value}”.</li>}
      </ul>
    </>
  );
}

export function Sidebar() {
  const { model, intents } = useOverlay();
  const { settings, pins } = model.engine.value;
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const width = liveWidth ?? settings.sidebarWidth;
  const narrow = model.viewportWidth.value < NARROW_VIEWPORT_PX;
  const side = settings.sidebarSide;

  const onResizeStart = (e: PointerEvent): void => {
    e.preventDefault();
    const strip = e.currentTarget as HTMLElement;
    strip.setPointerCapture?.(e.pointerId);
    const widthAt = (x: number): number =>
      clampWidth(side === 'right' ? innerWidth - SIDEBAR_MARGIN_PX - x : x - SIDEBAR_MARGIN_PX);
    let last = width;
    const move = (ev: PointerEvent): void => {
      last = widthAt(ev.clientX);
      setLiveWidth(last);
    };
    const up = (): void => {
      strip.removeEventListener('pointermove', move);
      strip.removeEventListener('pointerup', up);
      strip.removeEventListener('pointercancel', up);
      setLiveWidth(null);
      if (last !== settings.sidebarWidth) void intents.updateSettings({ sidebarWidth: last });
    };
    strip.addEventListener('pointermove', move);
    strip.addEventListener('pointerup', up);
    strip.addEventListener('pointercancel', up);
  };

  return (
    <aside
      class="pp-sidebar"
      role="complementary"
      aria-label="AI Pinpoint pinned messages"
      data-side={side}
      data-narrow={String(narrow)}
      style={{ width: `${width}px` }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          if (model.menu.value) model.menu.value = null;
          else intents.setSidebarOpen(false);
        }
      }}
    >
      {!narrow && (
        <div
          class="pp-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={onResizeStart}
        />
      )}
      <header class="pp-header">
        <h2 class="pp-title">Pinned</h2>
        <span class="pp-count">{pins.length}</span>
        <span class="pp-spacer" />
        <button type="button" class="pp-icon-btn" aria-label="Collapse sidebar" onClick={() => intents.setSidebarOpen(false)}>
          <Icon name={side === 'right' ? 'chevron-right' : 'chevron-left'} />
        </button>
      </header>
      <Tabs />
      <HealthBanner />
      <div id="pp-panel" role="tabpanel" aria-labelledby={`pp-tab-${model.tab.value}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {model.tab.value === 'chat' ? <PinList /> : <ThreadList />}
      </div>
      <footer class="pp-footer">
        <span>Saved on this device only</span>
        <span class="pp-spacer" />
        <button type="button" class="pp-icon-btn" aria-label="Open settings" onClick={() => intents.openOptions()}>
          <Icon name="settings" />
        </button>
      </footer>
    </aside>
  );
}
