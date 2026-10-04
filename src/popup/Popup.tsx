/**
 * Popup (UI_SPEC.md §11): host name + enabled toggle, pin count for the current chat, and
 * "Open sidebar" / "Export" / "Settings". Shows a count only — never message content.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Settings } from '@shared/schema';
import type { TabStatus } from '@shared/rpc';
import { HOST_META, TOGGLEABLE_HOSTS } from '@content/adapters/hosts';
import { exportFilename, type PageApi } from '../ui/api';

export function Popup({ api, onSettings }: { api: PageApi; onSettings?: (s: Settings) => void }) {
  const [tabId, setTabId] = useState<number | null>(null);
  const [status, setStatus] = useState<TabStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.call('settings:get', null);
        setSettings(s);
        onSettings?.(s);
        const id = await api.activeHostTab();
        setTabId(id);
        if (id !== null) setStatus(await api.sendToTab(id, 'ui:status', null));
      } catch {
        setError("Couldn't reach the extension. Try reopening this popup.");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const host = status ? HOST_META[status.hostId] : null;
  const enabled = status && settings ? settings.hosts[status.hostId].enabled : false;

  const toggle = async (): Promise<void> => {
    if (!status || !settings) return;
    const hosts = { ...settings.hosts, [status.hostId]: { enabled: !enabled } };
    try {
      const next = await api.call('settings:set', { hosts });
      setSettings(next);
      if (tabId !== null) setStatus(await api.sendToTab(tabId, 'ui:status', null));
    } catch {
      setError("Couldn't save that change.");
    }
  };

  const exportAll = async (): Promise<void> => {
    try {
      const bundle = await api.call('transfer:export', null);
      api.download(exportFilename(new Date()), JSON.stringify(bundle, null, 2));
    } catch {
      setError("Couldn't export your pins.");
    }
  };

  const openSidebar = async (): Promise<void> => {
    if (tabId === null) return;
    await api.sendToTab(tabId, 'ui:openSidebar', null);
    api.closeWindow();
  };

  let summary: string;
  if (!status) summary = `Open a ${TOGGLEABLE_HOSTS.map((h) => HOST_META[h].label).join(', ')} chat to pin messages.`;
  else if (!enabled) summary = `Turned off on ${host?.label ?? 'this site'}.`;
  else if (status.transient) summary = "This chat isn't saved yet — pins are kept until you send a message.";
  else summary = `${status.pinCount} ${status.pinCount === 1 ? 'pin' : 'pins'} in this chat`;

  return (
    <main class="popup" aria-busy={!loaded}>
      <h1>AI Pinpoint</h1>
      {status && host && (
        <label class="row">
          <span>{host.label}</span>
          <span class="spacer" />
          <input
            type="checkbox"
            role="switch"
            class="switch"
            aria-label={`Enabled on ${host.label}`}
            checked={enabled}
            onChange={() => void toggle()}
          />
        </label>
      )}
      {loaded && <p style={{ margin: 0 }} role="status">{summary}</p>}
      {error && <p class="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div class="stack">
        <button type="button" class="btn btn-primary" disabled={!status || !enabled} onClick={() => void openSidebar()}>
          Open sidebar
        </button>
        <div class="row">
          <button type="button" class="btn" style={{ flex: 1 }} onClick={() => void exportAll()}>
            Export
          </button>
          <button type="button" class="btn" style={{ flex: 1 }} onClick={() => api.openOptions()}>
            Settings
          </button>
        </div>
      </div>
      <footer class="muted">Version {api.version} · works fully offline</footer>
    </main>
  );
}
