/**
 * Overlay root: edge handle or sidebar, toast, first-run tip, and the polite live region.
 * Defers to host modals (collapsed, faded handle) and hides in fullscreen (UI_SPEC.md §9).
 */
import { FIRST_RUN_TIP_WIDTH_PX, SIDEBAR_MARGIN_PX } from '@shared/constants';
import { useEffect, useState } from 'preact/hooks';
import { useOverlay } from './context';
import { Icon } from './icons';
import { Sidebar } from './Sidebar';
import { Toast } from './Toast';

function Handle({ faded }: { faded: boolean }) {
  const { model, intents } = useOverlay();
  const { pins, settings } = model.engine.value;
  return (
    <button
      type="button"
      class="pp-handle"
      data-side={settings.sidebarSide}
      data-faded={String(faded)}
      aria-label={`Open pinned messages (${pins.length})`}
      aria-expanded="false"
      title="Pinned messages (Alt+Shift+S)"
      onClick={() => intents.setSidebarOpen(true)}
    >
      <Icon name="pin" />
      {pins.length > 0 && <span class="pp-badge" aria-hidden="true">{pins.length}</span>}
    </button>
  );
}

function FirstRunTip() {
  const { model, intents } = useOverlay();
  const anchor = model.engine.value.firstRunAnchor;
  if (!anchor) return null;
  // The tip is centred on its anchor; keep it fully inside the viewport near either edge.
  const half = FIRST_RUN_TIP_WIDTH_PX / 2 + SIDEBAR_MARGIN_PX;
  const x = Math.max(half, Math.min(innerWidth - half, anchor.x));
  return (
    <div class="pp-tip" role="dialog" aria-label="Getting started" style={{ left: `${x}px`, top: `${anchor.y}px` }}>
      Pin any message. Pinned messages appear in the sidebar.
      <div>
        <button type="button" onClick={() => void intents.dismissFirstRun()}>
          Got it
        </button>
      </div>
    </div>
  );
}

function LiveRegion() {
  const { model } = useOverlay();
  const [text, setText] = useState('');
  const announcement = model.engine.value.announcement;
  useEffect(() => {
    if (announcement) setText(announcement.text);
  }, [announcement?.id]);
  return (
    <div class="pp-sr" aria-live="polite" role="status">
      {text}
    </div>
  );
}

export function App() {
  const { model } = useOverlay();
  const s = model.engine.value;
  if (s.status === 'disabled' || s.status === 'stopped' || s.fullscreen) return null;
  const open = s.sidebarOpen && !s.hostModal;
  return (
    <>
      {open ? <Sidebar /> : <Handle faded={s.hostModal} />}
      <Toast />
      {!s.hostModal && <FirstRunTip />}
      <LiveRegion />
    </>
  );
}
