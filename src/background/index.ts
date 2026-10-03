/**
 * Service worker entry. Wires storage, migrations, transfer, and the RPC server.
 * No DOM, no host knowledge, no network (ARCHITECTURE.md I1, I6).
 */
import { logger } from '@shared/logger';
import type { ThreadRef } from '@shared/rpc';
import { sendToHostTabs } from './broadcast';
import { dispatchCommand, type TabsApi } from './commands';
import { onMenuClicked, registerContextMenu } from './context-menu';
import { chromeLocalArea } from './kv';
import { createLocks } from './lock';
import { createMigrator } from './migrate';
import { createRpcServer } from './rpc-server';
import { createStore } from './store';
import { buildExport } from './transfer';

const log = logger('background');

const area = chromeLocalArea();
const locks = createLocks();
const now = (): number => Date.now();
const extensionVersion = chrome.runtime.getManifest().version;

const migrator = createMigrator({
  area,
  now,
  buildBackup: () => buildExport(area, extensionVersion, now()),
});

function broadcast(ref: ThreadRef): void {
  sendToHostTabs('store:changed', ref).catch((err: unknown) => log.warn('broadcast failed', err));
}

const store = createStore({
  area,
  locks,
  now,
  broadcast,
  isReadOnly: () => migrator.state().readOnly,
});

const server = createRpcServer({
  store,
  migrator,
  transfer: { area, locks, store, now, extensionVersion, broadcast },
  openOptions: () => chrome.runtime.openOptionsPage(),
  onSettingsChanged: (settings) => {
    sendToHostTabs('settings:changed', settings).catch((err: unknown) => log.warn('settings broadcast failed', err));
  },
});

const tabs: TabsApi = {
  query: (q) => chrome.tabs.query(q),
  sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
};

chrome.runtime.onInstalled.addListener((details) => {
  log.info('installed', details.reason);
  migrator.ensure().catch((err: unknown) => log.error('migration failed', err));
  registerContextMenu(chrome.contextMenus).catch((err: unknown) => log.error('context menu failed', err));
});

chrome.commands.onCommand.addListener((command, tab) => {
  dispatchCommand(tabs, command, tab).catch((err: unknown) => log.warn('command failed', command, err));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  onMenuClicked(tabs, info, tab).catch((err: unknown) => log.warn('menu failed', err));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only our own extension's pages and content scripts may talk to the store.
  if (sender.id !== chrome.runtime.id) return false;
  server
    .handle(message)
    .then(sendResponse)
    .catch((err: unknown) => log.error('rpc failed', err));
  return true; // keep the channel open for the async response
});
