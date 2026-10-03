/**
 * "Pin this message" on selected text, restricted to host documents by the manifest's own
 * content-script patterns (the worker names no host, I1). The selection is forwarded as data;
 * the content script resolves it to the containing message node.
 */
import { MAX_SELECTION_CHARS } from '@shared/constants';
import { contentPatterns, makeContentMessage } from './broadcast';
import type { TabsApi } from './commands';

export const MENU_ID = 'pinpoint-pin-selection';

export interface MenusApi {
  removeAll(): Promise<void>;
  create(props: chrome.contextMenus.CreateProperties): void;
}

export async function registerContextMenu(menus: MenusApi): Promise<void> {
  await menus.removeAll();
  menus.create({
    id: MENU_ID,
    title: 'Pin this message',
    contexts: ['selection'],
    documentUrlPatterns: contentPatterns(),
  });
}

export async function onMenuClicked(
  tabs: TabsApi,
  info: Pick<chrome.contextMenus.OnClickData, 'menuItemId' | 'selectionText'>,
  tab?: chrome.tabs.Tab,
): Promise<boolean> {
  if (info.menuItemId !== MENU_ID || tab?.id === undefined || tab.id < 0) return false;
  const selectionText = (info.selectionText ?? '').slice(0, MAX_SELECTION_CHARS);
  try {
    await tabs.sendMessage(tab.id, makeContentMessage('menu:pinSelection', { selectionText }));
    return true;
  } catch {
    return false;
  }
}
