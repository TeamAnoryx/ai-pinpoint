/**
 * Options page (UI_SPEC.md §12): hosts, appearance, behaviour, shortcuts, data, about.
 * Every change is one settings:set; the worker broadcasts it so open tabs apply it live.
 */
import { useEffect, useState } from 'preact/hooks';
import {
  HIGHLIGHT_MS_MAX,
  HIGHLIGHT_MS_MIN,
  MAX_SNIPPET_CHARS,
  MIN_SNIPPET_CHARS,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '@shared/constants';
import type { Settings } from '@shared/schema';
import { HOST_META, TOGGLEABLE_HOSTS } from '@content/adapters/hosts';
import type { CommandInfo, PageApi } from '../ui/api';
import { DataSection } from './DataSection';

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

interface SectionProps {
  settings: Settings;
  save: (patch: Partial<Settings>) => Promise<void>;
}

function Hosts({ settings, save }: SectionProps) {
  return (
    <section aria-labelledby="h-hosts">
      <h2 id="h-hosts">Hosts</h2>
      <div class="stack">
        {TOGGLEABLE_HOSTS.map((h) => (
          <label key={h}>
            <input
              type="checkbox"
              role="switch"
              class="switch"
              checked={settings.hosts[h].enabled}
              onChange={(e) =>
                void save({ hosts: { ...settings.hosts, [h]: { enabled: (e.target as HTMLInputElement).checked } } })
              }
            />
            <span>{HOST_META[h].label}</span>
            <span class="muted">{HOST_META[h].origins.join(', ')}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function Select<T extends string>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="field">
      <span>{props.label}</span>
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onChange((e.target as HTMLSelectElement).value as T)}
      >
        {props.options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Range input that saves on release, not on every pixel of a drag. */
function Slider(props: { label: string; value: number; min: number; max: number; step: number; unit: string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <div class="field">
      <span>{props.label}</span>
      <label>
        <input
          type="range"
          aria-label={props.label}
          min={props.min}
          max={props.max}
          step={props.step}
          value={v}
          onInput={(e) => setV(Number((e.target as HTMLInputElement).value))}
          onChange={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
        />
        <span class="muted" style={{ minWidth: '64px' }}>
          {v} {props.unit}
        </span>
      </label>
    </div>
  );
}

function Appearance({ settings, save }: SectionProps) {
  return (
    <section aria-labelledby="h-appearance">
      <h2 id="h-appearance">Appearance</h2>
      <Select label="Sidebar side" value={settings.sidebarSide} options={[['right', 'Right'], ['left', 'Left']]} onChange={(v) => void save({ sidebarSide: v })} />
      <Select label="Theme" value={settings.theme} options={[['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => void save({ theme: v })} />
      <Select label="Reduced motion" value={settings.reducedMotion} options={[['auto', 'Match system'], ['on', 'On'], ['off', 'Off']]} onChange={(v) => void save({ reducedMotion: v })} />
      <div class="field">
        <span>Start collapsed</span>
        <input type="checkbox" role="switch" class="switch" aria-label="Start collapsed" checked={settings.startCollapsed} onChange={(e) => void save({ startCollapsed: (e.target as HTMLInputElement).checked })} />
      </div>
      <Slider label="Sidebar width" value={settings.sidebarWidth} min={SIDEBAR_WIDTH_MIN} max={SIDEBAR_WIDTH_MAX} step={10} unit="px" onCommit={(v) => void save({ sidebarWidth: v })} />
    </section>
  );
}

function Behaviour({ settings, save }: SectionProps) {
  return (
    <section aria-labelledby="h-behaviour">
      <h2 id="h-behaviour">Behaviour</h2>
      <Slider label="Snippet length" value={settings.snippetChars} min={MIN_SNIPPET_CHARS} max={MAX_SNIPPET_CHARS} step={10} unit="chars" onCommit={(v) => void save({ snippetChars: v })} />
      <Slider label="Highlight duration" value={settings.highlightMs} min={HIGHLIGHT_MS_MIN} max={HIGHLIGHT_MS_MAX} step={100} unit="ms" onCommit={(v) => void save({ highlightMs: v })} />
    </section>
  );
}

function Shortcuts({ api }: { api: PageApi }) {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.commands().then(setCommands, () => setCommands([]));
  }, []);
  return (
    <section aria-labelledby="h-shortcuts">
      <h2 id="h-shortcuts">Shortcuts</h2>
      <table>
        <tbody>
          {commands.map((c) => (
            <tr key={c.name}>
              <td>{c.description}</td>
              <td>{c.shortcut ? <code>{c.shortcut}</code> : <span class="muted">Not set</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="row">
        <span>Change them at</span> <code>{SHORTCUTS_URL}</code>
        <button
          type="button"
          class="btn"
          onClick={() => void api.copy(SHORTCUTS_URL).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </p>
    </section>
  );
}

export function Options({ api, onSettings }: { api: PageApi; onSettings?: (s: Settings) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (s: Settings): void => {
    setSettings(s);
    onSettings?.(s);
  };
  useEffect(() => {
    api.call('settings:get', null).then(apply, () => setError("Couldn't load settings."));
  }, []);

  const save = async (patch: Partial<Settings>): Promise<void> => {
    try {
      apply(await api.call('settings:set', patch));
      setError(null);
    } catch {
      setError("Couldn't save that setting.");
    }
  };

  return (
    <main class="options">
      <h1>AI Pinpoint — Settings</h1>
      {error && <p class="error" role="alert">{error}</p>}
      {settings && (
        <>
          <Hosts settings={settings} save={save} />
          <Appearance settings={settings} save={save} />
          <Behaviour settings={settings} save={save} />
        </>
      )}
      <Shortcuts api={api} />
      <DataSection api={api} onSettingsReplaced={apply} />
      <section aria-labelledby="h-about">
        <h2 id="h-about">About</h2>
        <p>Version {api.version}</p>
        <p class="muted">Works fully offline — no accounts, no servers, no data leaves this device.</p>
      </section>
    </main>
  );
}
