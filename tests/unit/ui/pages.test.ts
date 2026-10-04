import { h, render } from 'preact';
import type { TabStatus } from '@shared/rpc';
import { Options } from '../../../src/options/Options';
import { Popup } from '../../../src/popup/Popup';
import type { PageApi } from '../../../src/ui/api';
import { makeWorker } from '../../support/worker';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await tick(5);
  }
};

const META = { title: 'Saved chat', url: 'https://example.test/c/1' };
const pin = (id: string) => ({
  pinId: id,
  targetHash: `c:${id}:1`,
  nativeId: null,
  role: 'user' as const,
  snippet: `snippet ${id}`,
  textLength: 10,
  ordinal: 1,
  label: null,
  createdAt: 1,
});

function makeApi(tabStatus: TabStatus | null) {
  const worker = makeWorker();
  const downloads: { name: string; text: string }[] = [];
  const tabMessages: string[] = [];
  let opened = 0;
  let closed = 0;
  let status = tabStatus;
  const api: PageApi = {
    call: worker.proxy.call,
    activeHostTab: async () => (status ? 1 : null),
    sendToTab: async (_tab, type) => {
      tabMessages.push(type);
      if (type === 'ui:status') {
        if (!status) return null;
        const s = await worker.proxy.call('settings:get', null);
        status = { ...status, status: s.hosts[status.hostId].enabled ? 'running' : 'disabled' };
        return status as never;
      }
      return { ack: true } as never;
    },
    openOptions: () => void opened++,
    closeWindow: () => void closed++,
    version: '1.2.3',
    commands: async () => [{ name: 'pin-last', description: 'Pin the last assistant message', shortcut: 'Alt+Shift+P' }],
    download: (name, text) => void downloads.push({ name, text }),
    copy: async () => undefined,
  };
  return { api, worker, downloads, tabMessages, opened: () => opened, closed: () => closed };
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  render(null, container);
  container.remove();
});

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null => container.querySelector<T>(sel);
const byText = (sel: string, text: string): HTMLElement | undefined =>
  [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(text));
const change = (el: HTMLInputElement | HTMLSelectElement, value: string | boolean): void => {
  if (typeof value === 'boolean') (el as HTMLInputElement).checked = value;
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('popup', () => {
  const status: TabStatus = { hostId: 'claude', status: 'running', threadId: 'claude:x', transient: false, pinCount: 3 };

  test('host toggle, pin count, open sidebar, export, settings', async () => {
    const t = makeApi(status);
    render(h(Popup, { api: t.api }), container);
    await waitFor(() => $('[role="status"]')?.textContent === '3 pins in this chat');
    expect($('label')!.textContent).toContain('Claude');
    expect($('footer')!.textContent).toContain('1.2.3');

    change($<HTMLInputElement>('[role="switch"]')!, false);
    await waitFor(() => $('[role="status"]')?.textContent === 'Turned off on Claude.');
    expect((await t.worker.proxy.call('settings:get', null)).hosts.claude.enabled).toBe(false);

    change($<HTMLInputElement>('[role="switch"]')!, true);
    await waitFor(() => $('[role="status"]')?.textContent?.includes('pins in this chat') === true);
    byText('button', 'Open sidebar')!.click();
    await waitFor(() => t.closed() === 1);
    expect(t.tabMessages).toContain('ui:openSidebar');

    byText('button', 'Export')!.click();
    await waitFor(() => t.downloads.length === 1);
    expect(JSON.parse(t.downloads[0]!.text).kind).toBe('ai-pinpoint-export');
    expect(t.downloads[0]!.name).toMatch(/^ai-pinpoint-\d{4}-\d{2}-\d{2}\.json$/);

    byText('button', 'Settings')!.click();
    expect(t.opened()).toBe(1);
  });

  test('on a non-host tab it explains where it works and never names message content', async () => {
    const t = makeApi(null);
    render(h(Popup, { api: t.api }), container);
    await waitFor(() => $('[role="status"]') !== null);
    expect($('[role="status"]')!.textContent).toBe('Open a Gemini, ChatGPT, Claude chat to pin messages.');
    expect(byText('button', 'Open sidebar')!.hasAttribute('disabled')).toBe(true);
  });
});

describe('options', () => {
  async function mount() {
    const t = makeApi(null);
    for (const id of ['claude:a', 'claude:b']) {
      await t.worker.proxy.call('pins:add', { hostId: 'claude', threadId: id, pin: pin(`${id}-1`), thread: META });
    }
    render(h(Options, { api: t.api }), container);
    await waitFor(() => $('#h-hosts') !== null && byText('td', 'Saved chat') !== undefined);
    return t;
  }

  test('settings persist: host toggle, theme, side, snippet length', async () => {
    const t = await mount();
    const hostSwitch = $<HTMLInputElement>('section[aria-labelledby="h-hosts"] input')!;
    change(hostSwitch, false);
    await waitFor(() => t.worker.calls.filter((c) => c === 'settings:set').length === 1);
    change($<HTMLSelectElement>('select[aria-label="Theme"]')!, 'dark');
    change($<HTMLSelectElement>('select[aria-label="Sidebar side"]')!, 'left');
    change($<HTMLInputElement>('input[aria-label="Snippet length"]')!, '200');
    let s = await t.worker.proxy.call('settings:get', null);
    const end = Date.now() + 3000;
    while (s.snippetChars !== 200 && Date.now() < end) {
      await tick(10);
      s = await t.worker.proxy.call('settings:get', null);
    }
    expect(s).toMatchObject({ theme: 'dark', sidebarSide: 'left', snippetChars: 200 });
    expect(s.hosts.gemini.enabled).toBe(false);
    expect(byText('td', 'Pin the last assistant message')).toBeDefined();
  });

  test('import dry-run numbers equal the committed result', async () => {
    const t = await mount();
    const bundle = await t.worker.proxy.call('transfer:export', null);
    await t.worker.proxy.call('pins:remove', { hostId: 'claude', threadId: 'claude:a', pinId: 'claude:a-1' });
    const file = $<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(file, 'files', { value: [new File([JSON.stringify(bundle)], 'x.json')] });
    file.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => !byText('button', 'Preview')!.hasAttribute('disabled'));
    byText('button', 'Preview')!.click();
    await waitFor(() => $('table[aria-label="Import preview"]') !== null);
    const read = (label: string) =>
      [...container.querySelectorAll('[data-field]')].map((c) => `${c.getAttribute('data-field')}=${c.textContent}`).join(',') + label;
    const preview = read('');
    byText('button', 'Import (merge)')!.click();
    await waitFor(() => $('table[aria-label="Import result"]') !== null);
    expect(read('')).toBe(preview);
    expect(preview).toContain('pinsAdded=1');
  });

  test('prune reports reclaimed bytes; wipe needs DELETE', async () => {
    const t = await mount();
    const box = $<HTMLInputElement>('input[aria-label="Select Saved chat"]')!;
    change(box, true);
    await waitFor(() => byText('button', 'Remove 1 selected') !== undefined);
    byText('button', 'Remove 1 selected')!.click();
    await waitFor(() => /Removed 1 chat, reclaimed \d/.test($('[role="status"]')?.textContent ?? ''));

    const wipeBtn = byText('button', 'Wipe everything')!;
    expect(wipeBtn.hasAttribute('disabled')).toBe(true);
    change($<HTMLInputElement>('input[aria-label="Type DELETE to confirm"]')!, 'DELETE');
    await waitFor(() => !byText('button', 'Wipe everything')!.hasAttribute('disabled'));
    byText('button', 'Wipe everything')!.click();
    await waitFor(() => /Deleted everything/.test($('[role="status"]')?.textContent ?? ''));
    expect(await t.worker.proxy.call('threads:list', { hostId: 'claude' })).toEqual([]);
  });
});
