/**
 * Degraded-mode, storage, and version banners (UI_SPEC.md §10). Plain language, an action
 * where one exists, dismissible per session.
 */
import { useOverlay } from './context';
import { Icon } from './icons';

interface Action {
  label: string;
  run: () => void;
}

interface Banner {
  key: string;
  text: string;
  kind: 'neutral' | 'danger';
  actions: Action[];
  dismissible: boolean;
}

const HEALTH_COPY: Record<string, string> = {
  'degraded:no-mount': 'This layout hides the pin button. Use Alt+Shift+P or right-click a message to pin.',
  'degraded:no-messages': "Couldn't read this conversation. Your saved pins are still here; jumping may be slower.",
  'degraded:no-thread': "This chat has no ID yet — pins won't be saved until you send a message.",
  'disabled:adapter-error': 'Something changed on this site.',
};

export function HealthBanner() {
  const { model, intents } = useOverlay();
  const { health, storage, status } = model.engine.value;
  const manage: Action = { label: 'Manage', run: () => intents.openOptions() };
  const banners: Banner[] = [];

  if (status === 'version-mismatch') {
    banners.push({
      key: 'version',
      text: 'Extension updated — reload this tab.',
      kind: 'danger',
      actions: [{ label: 'Reload', run: () => location.reload() }],
      dismissible: false,
    });
  }
  const copy = HEALTH_COPY[health.state];
  if (copy) {
    const failed = health.state === 'disabled:adapter-error';
    banners.push({
      key: health.state,
      text: copy,
      kind: failed ? 'danger' : 'neutral',
      actions: failed ? [{ label: 'Retry', run: () => void intents.retry() }] : [],
      dismissible: !failed,
    });
  }
  if (storage?.readOnly) {
    banners.push({
      key: 'read-only',
      text: 'Your pins were saved by a newer version. Update the extension to edit them.',
      kind: 'danger',
      actions: [],
      dismissible: true,
    });
  } else if (storage && storage.level !== 'ok') {
    const full = storage.level === 'block';
    banners.push({
      key: `quota-${storage.level}`,
      text: full ? "Storage full — new pins can't be saved." : 'Storage is 80% full.',
      kind: full ? 'danger' : 'neutral',
      actions: [{ label: 'Export', run: () => intents.openOptions() }, manage],
      dismissible: !full,
    });
  }
  if (storage && storage.quarantined > 0) {
    banners.push({
      key: 'quarantine',
      text: 'Some saved pins could not be read and were set aside, not deleted.',
      kind: 'neutral',
      actions: [manage],
      dismissible: true,
    });
  }

  const visible = banners.filter((b) => !model.dismissed.value.has(b.key));
  return (
    <>
      {visible.map((b) => (
        <div key={b.key} class="pp-banner" role="status" data-kind={b.kind}>
          <Icon name="alert-triangle" />
          <p>
            {b.text}
            {b.actions.map((a) => (
              <span key={a.label}>
                {' '}
                <button type="button" class="pp-link" onClick={a.run}>
                  {a.label}
                </button>
              </span>
            ))}
          </p>
          {b.dismissible && (
            <button
              type="button"
              class="pp-icon-btn"
              aria-label="Dismiss"
              onClick={() => (model.dismissed.value = new Set([...model.dismissed.value, b.key]))}
            >
              <Icon name="x" />
            </button>
          )}
        </div>
      ))}
    </>
  );
}
