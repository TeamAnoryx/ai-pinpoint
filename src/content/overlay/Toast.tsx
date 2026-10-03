/** Single toast (UI_SPEC.md §10); the engine owns timing, newest replaces. */
import { useOverlay } from './context';

const ACTION_LABEL = { undo: 'Undo', retry: 'Retry', export: 'Export', reload: 'Reload' } as const;

export function Toast() {
  const { model, intents } = useOverlay();
  const { toast, settings } = model.engine.value;
  if (!toast) return null;
  const run = (): void => {
    if (toast.action === 'undo') void intents.undo();
    else if (toast.action === 'export') intents.openOptions();
    else if (toast.action === 'reload') location.reload();
    intents.dismissToast();
  };
  return (
    <div class="pp-toast" role="status" data-kind={toast.kind} data-side={settings.sidebarSide} key={toast.id}>
      <span>{toast.text}</span>
      {toast.action && toast.action !== 'retry' && (
        <button type="button" onClick={run}>
          {ACTION_LABEL[toast.action]}
        </button>
      )}
    </div>
  );
}
