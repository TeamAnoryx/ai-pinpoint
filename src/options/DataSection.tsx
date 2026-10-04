/**
 * Options → Data (UI_SPEC.md §12): usage bar with per-host breakdown, export, import with a
 * dry-run table before commit, prune (oldest first, reports reclaimed bytes), and wipe with
 * the typed confirmation. All file I/O is local (PRD.md §6).
 */
import { useEffect, useState } from 'preact/hooks';
import { WIPE_CONFIRMATION, type ImportMode, type ImportReport, type StorageStats } from '@shared/rpc';
import { HOST_IDS, type HostId, type Settings, type ThreadSummary } from '@shared/schema';
import { formatRelative } from '@shared/time';
import { HOST_META } from '@content/adapters/hosts';
import { exportFilename, type PageApi } from '../ui/api';

const KB = 1024;

export function formatBytes(n: number): string {
  if (n < KB) return `${n} B`;
  if (n < KB * KB) return `${(n / KB).toFixed(1)} KB`;
  return `${(n / KB / KB).toFixed(2)} MB`;
}

interface Row {
  hostId: HostId;
  thread: ThreadSummary;
}

const REPORT_ROWS: [keyof ImportReport, string][] = [
  ['threadsAdded', 'Chats added'],
  ['threadsMerged', 'Chats merged'],
  ['threadsReplaced', 'Chats replaced'],
  ['pinsAdded', 'Pins added'],
  ['pinsConflicting', 'Pins already present'],
];

export function DataSection({ api, onSettingsReplaced }: { api: PageApi; onSettingsReplaced: (s: Settings) => void }) {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [importText, setImportText] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [wipeText, setWipeText] = useState('');

  const refresh = async (): Promise<void> => {
    setStats(await api.call('storage:stats', null));
    const all: Row[] = [];
    for (const hostId of HOST_IDS) {
      for (const thread of await api.call('threads:list', { hostId })) all.push({ hostId, thread });
    }
    setRows(all.sort((a, b) => a.thread.updatedAt - b.thread.updatedAt));
    setSelected(new Set());
  };
  useEffect(() => {
    refresh().catch(() => setMessage("Couldn't read storage."));
  }, []);

  const exportAll = async (): Promise<void> => {
    const bundle = await api.call('transfer:export', null);
    api.download(exportFilename(new Date()), JSON.stringify(bundle, null, 2));
  };

  const runImport = async (dryRun: boolean): Promise<void> => {
    if (importText === null) return;
    let bundle: unknown;
    try {
      bundle = JSON.parse(importText);
    } catch {
      setMessage("That file isn't valid JSON.");
      return;
    }
    try {
      const r = await api.call('transfer:import', { bundle, mode, dryRun });
      setReport(r);
      if (r.error) setMessage(r.error.message);
      else setMessage(dryRun ? null : 'Import complete.');
      if (!dryRun) {
        setImportText(null);
        if (mode === 'replace') onSettingsReplaced(await api.call('settings:get', null));
        await refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  const prune = async (): Promise<void> => {
    let removed = 0;
    let bytes = 0;
    for (const hostId of HOST_IDS) {
      const threadIds = rows.filter((r) => r.hostId === hostId && selected.has(key(r))).map((r) => r.thread.threadId);
      if (threadIds.length === 0) continue;
      const res = await api.call('threads:remove', { hostId, threadIds });
      removed += res.removed;
      bytes += res.bytesReclaimed;
    }
    setMessage(`Removed ${removed} ${removed === 1 ? 'chat' : 'chats'}, reclaimed ${formatBytes(bytes)}.`);
    await refresh();
  };

  const wipe = async (): Promise<void> => {
    const res = await api.call('storage:wipe', { confirm: WIPE_CONFIRMATION });
    setWipeText('');
    setMessage(`Deleted everything (${res.removedKeys} entries).`);
    onSettingsReplaced(await api.call('settings:get', null));
    await refresh();
  };

  const key = (r: Row): string => `${r.hostId}:${r.thread.threadId}`;
  const pct = stats ? Math.min(100, (stats.bytesUsed / stats.quota) * 100) : 0;
  const now = Date.now();

  return (
    <section aria-labelledby="h-data">
      <h2 id="h-data">Data</h2>
      {stats && (
        <div class="stack">
          <div class="bar" data-level={stats.level} role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={stats.quota} aria-valuenow={stats.bytesUsed}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span class="muted">
            {formatBytes(stats.bytesUsed)} of {formatBytes(stats.quota)} used ·{' '}
            {HOST_IDS.filter((h) => stats.perHost[h] > 0)
              .map((h) => `${HOST_META[h].label} ${formatBytes(stats.perHost[h])}`)
              .join(' · ') || 'no pins yet'}
          </span>
          {stats.quarantined.length > 0 && (
            <span>{stats.quarantined.length} unreadable record(s) were set aside, not deleted.</span>
          )}
          {stats.readOnly && <span class="error">Saved by a newer version — read-only until you update.</span>}
        </div>
      )}
      {message && <p role="status">{message}</p>}

      <h3>Export</h3>
      <button type="button" class="btn" onClick={() => void exportAll()}>
        Export all pins
      </button>

      <h3>Import</h3>
      <div class="row">
        <input
          type="file"
          accept="application/json,.json"
          aria-label="Choose an export file"
          onChange={async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            setReport(null);
            setImportText(file ? await file.text() : null);
          }}
        />
        <select aria-label="Import mode" value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as ImportMode)}>
          <option value="merge">Merge with current pins</option>
          <option value="replace">Replace current pins</option>
        </select>
        <button type="button" class="btn" disabled={importText === null} onClick={() => void runImport(true)}>
          Preview
        </button>
      </div>
      {report && (
        <div class="stack" style={{ marginTop: '8px' }}>
          <table aria-label={report.dryRun ? 'Import preview' : 'Import result'}>
            <tbody>
              {REPORT_ROWS.map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td data-field={k}>{String(report[k])}</td>
                </tr>
              ))}
              <tr>
                <td>Storage change</td>
                <td>{formatBytes(Math.max(0, report.bytesDelta))}</td>
              </tr>
            </tbody>
          </table>
          {report.dryRun && (
            <button
              type="button"
              class="btn btn-primary"
              disabled={report.quota === 'exceeded' || report.error !== null}
              onClick={() => void runImport(false)}
            >
              {report.quota === 'exceeded' ? 'Not enough space' : `Import (${mode})`}
            </button>
          )}
        </div>
      )}

      <h3>Prune</h3>
      {rows.length === 0 ? (
        <p class="muted">No saved chats.</p>
      ) : (
        <div class="stack">
          <table>
            <tbody>
              {rows.map((r) => (
                <tr key={key(r)}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.thread.title ?? 'untitled chat'}`}
                      checked={selected.has(key(r))}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if ((e.target as HTMLInputElement).checked) next.add(key(r));
                        else next.delete(key(r));
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>{r.thread.title ?? 'Untitled chat'}</td>
                  <td class="muted">{HOST_META[r.hostId].label}</td>
                  <td class="muted">{r.thread.pinCount} pins</td>
                  <td class="muted">{formatRelative(r.thread.updatedAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" class="btn btn-danger" disabled={selected.size === 0} onClick={() => void prune()}>
            Remove {selected.size} selected
          </button>
        </div>
      )}

      <h3>Wipe all</h3>
      <p class="muted">Deletes every pin, chat, and setting. Type {WIPE_CONFIRMATION} to confirm.</p>
      <div class="row">
        <input aria-label="Type DELETE to confirm" value={wipeText} onInput={(e) => setWipeText((e.target as HTMLInputElement).value)} />
        <button type="button" class="btn btn-danger" disabled={wipeText !== WIPE_CONFIRMATION} onClick={() => void wipe()}>
          Wipe everything
        </button>
      </div>
    </section>
  );
}
