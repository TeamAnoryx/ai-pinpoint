/**
 * chrome.commands → active host tab (ARCHITECTURE.md §8). No `tabs` permission (R13):
 * Chrome passes the active tab to onCommand, and host permissions let a url-filtered
 * tabs.query find it otherwise; tabs.sendMessage needs no permission at all.
 */
import type { ContentRpcType } from '@shared/rpc';
import { contentPatterns, makeContentMessage } from './broadcast';

export const COMMAND_MESSAGES: Record<string, ContentRpcType> = {
  'pin-last': 'command:pinLast',
  'toggle-sidebar': 'command:toggleSidebar',
  'focus-filter': 'command:focusFilter',
};

export interface TabsApi {
  query(q: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

/** Resolve the tab a command targets: Chrome's tab argument, else the active host tab. */
export async function targetTab(tabs: TabsApi, given?: chrome.tabs.Tab): Promise<number | null> {
  if (given?.id !== undefined && given.id >= 0) return given.id;
  const [active] = await tabs.query({ active: true, currentWindow: true, url: contentPatterns() });
  return active?.id ?? null;
}

export async function dispatchCommand(tabs: TabsApi, command: string, tab?: chrome.tabs.Tab): Promise<boolean> {
  const type = COMMAND_MESSAGES[command];
  if (!type) return false;
  const tabId = await targetTab(tabs, tab);
  if (tabId === null) return false;
  try {
    await tabs.sendMessage(tabId, makeContentMessage(type, null));
    return true;
  } catch {
    return false; // not a host tab, or its content script is gone (page reload pending)
  }
}
