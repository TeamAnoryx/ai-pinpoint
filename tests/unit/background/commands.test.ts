import { COMMAND_MESSAGES, dispatchCommand, targetTab, type TabsApi } from '@background/commands';
import { MENU_ID, onMenuClicked, registerContextMenu } from '@background/context-menu';
import { MAX_SELECTION_CHARS } from '@shared/constants';
import { RPC_PROTOCOL } from '@shared/rpc';

const PATTERNS = ['https://claude.ai/*', 'https://chatgpt.com/*'];

beforeAll(() => {
  (globalThis as Record<string, unknown>)['chrome'] = {
    runtime: { getManifest: () => ({ content_scripts: [{ matches: PATTERNS }] }) },
  };
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>)['chrome'];
});

function fakeTabs(active: chrome.tabs.Tab[] = []) {
  const sent: { tabId: number; message: unknown }[] = [];
  const queries: chrome.tabs.QueryInfo[] = [];
  const api: TabsApi = {
    query: async (q) => {
      queries.push(q);
      return active;
    },
    sendMessage: async (tabId, message) => {
      sent.push({ tabId, message });
      return { ack: true };
    },
  };
  return { api, sent, queries };
}

const tab = (id: number): chrome.tabs.Tab => ({ id }) as chrome.tabs.Tab;

describe('commands', () => {
  test('every manifest command maps to a content message', () => {
    expect(Object.keys(COMMAND_MESSAGES).sort()).toEqual(['focus-filter', 'pin-last', 'toggle-sidebar']);
  });

  test('uses the tab Chrome passes, without querying', async () => {
    const t = fakeTabs();
    expect(await dispatchCommand(t.api, 'pin-last', tab(7))).toBe(true);
    expect(t.queries).toHaveLength(0);
    expect(t.sent[0]).toEqual({
      tabId: 7,
      message: expect.objectContaining({ protocol: RPC_PROTOCOL, type: 'command:pinLast', payload: null }),
    });
  });

  test('falls back to a url-filtered active-tab query (host permissions, no tabs permission)', async () => {
    const t = fakeTabs([tab(3)]);
    expect(await targetTab(t.api)).toBe(3);
    expect(t.queries[0]).toEqual({ active: true, currentWindow: true, url: PATTERNS });
    expect(await dispatchCommand(t.api, 'toggle-sidebar')).toBe(true);
    expect(t.sent[0]!.message).toMatchObject({ type: 'command:toggleSidebar' });
  });

  test('unknown command or no host tab → no message', async () => {
    const t = fakeTabs([]);
    expect(await dispatchCommand(t.api, 'nope', tab(1))).toBe(false);
    expect(await dispatchCommand(t.api, 'focus-filter')).toBe(false);
    expect(t.sent).toHaveLength(0);
  });

  test('a tab without a live content script does not throw', async () => {
    const api: TabsApi = { query: async () => [], sendMessage: async () => Promise.reject(new Error('Receiving end does not exist')) };
    expect(await dispatchCommand(api, 'pin-last', tab(9))).toBe(false);
  });
});

describe('context menu', () => {
  test('registered for selections on host documents only', async () => {
    const created: chrome.contextMenus.CreateProperties[] = [];
    let cleared = 0;
    await registerContextMenu({
      removeAll: async () => {
        cleared++;
      },
      create: (p) => created.push(p),
    });
    expect(cleared).toBe(1);
    expect(created).toEqual([
      { id: MENU_ID, title: 'Pin this message', contexts: ['selection'], documentUrlPatterns: PATTERNS },
    ]);
  });

  test('click forwards the (clamped) selection to that tab', async () => {
    const t = fakeTabs();
    const long = 'x'.repeat(MAX_SELECTION_CHARS + 50);
    expect(await onMenuClicked(t.api, { menuItemId: MENU_ID, selectionText: long }, tab(4))).toBe(true);
    expect(t.sent[0]).toEqual({
      tabId: 4,
      message: expect.objectContaining({ type: 'menu:pinSelection', payload: { selectionText: 'x'.repeat(MAX_SELECTION_CHARS) } }),
    });
    expect(await onMenuClicked(t.api, { menuItemId: 'other', selectionText: 'a' }, tab(4))).toBe(false);
  });
});
