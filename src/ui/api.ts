/**
 * Extension-page API for the popup and options page: typed worker RPC plus the few chrome.*
 * calls those pages need. Injected so the pages render in tests without a browser.
 */
import { RPC_PROTOCOL, type ContentRpcType, type RpcPayload, type RpcResult, type WorkerRpcType } from '@shared/rpc';
import { createStoreProxy, type StoreProxy } from '@content/core/store-proxy';

export interface CommandInfo {
  name: string;
  description: string;
  shortcut: string;
}

export interface PageApi {
  call: StoreProxy['call'];
  /** Active tab id when it is a supported host tab (url-filtered; no `tabs` permission). */
  activeHostTab(): Promise<number | null>;
  sendToTab<K extends ContentRpcType>(tabId: number, type: K, payload: RpcPayload<K>): Promise<RpcResult<K> | null>;
  openOptions(): void;
  closeWindow(): void;
  /** Reload a tab (no permission needed); starts the content script in tabs opened before install. */
  reloadTab(tabId: number): Promise<void>;
  version: string;
  commands(): Promise<CommandInfo[]>;
  /** Save a file the user asked for (export). */
  download(filename: string, text: string): void;
  copy(text: string): Promise<void>;
}

export type { WorkerRpcType };

function contentPatterns(): string[] {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  return [...new Set(scripts.flatMap((s) => s.matches ?? []))];
}

let seq = 0;

export function chromePageApi(): PageApi {
  const proxy = createStoreProxy();
  return {
    call: proxy.call,
    async activeHostTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true, url: contentPatterns() });
      return tab?.id ?? null;
    },
    async sendToTab(tabId, type, payload) {
      try {
        const res = (await chrome.tabs.sendMessage(tabId, {
          protocol: RPC_PROTOCOL,
          type,
          requestId: `page-${++seq}`,
          payload,
        })) as { ok?: boolean; data?: unknown } | undefined;
        return res?.ok ? (res.data as RpcResult<typeof type>) : null;
      } catch {
        return null; // no live content script in that tab
      }
    },
    openOptions: () => void chrome.runtime.openOptionsPage(),
    closeWindow: () => window.close(),
    reloadTab: (tabId) => chrome.tabs.reload(tabId),
    version: chrome.runtime.getManifest().version,
    async commands() {
      const all = await chrome.commands.getAll();
      return all
        .filter((c) => c.name && c.name !== '_execute_action')
        .map((c) => ({ name: c.name ?? '', description: c.description ?? '', shortcut: c.shortcut ?? '' }));
    },
    download(filename, text) {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url));
    },
    copy: (text) => navigator.clipboard.writeText(text),
  };
}

export function exportFilename(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `ai-pinpoint-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
