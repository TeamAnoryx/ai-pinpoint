/**
 * Core engine (ARCHITECTURE.md §4–§5, I4): the only module that talks to both the adapter
 * and the store. Boots, reconciles host DOM into the identity index and pin buttons, runs
 * navigation, handles thread switches, and publishes state for the overlay.
 */
import {
  FIRST_RUN_TOOLTIP_MS,
  OBSERVER_ROOT_POLL_MS,
  OBSERVER_ROOT_TIMEOUT_MS,
  ORDER_STEP,
  STREAM_RECHECK_MS,
  TOAST_ACTION_MS,
  TOAST_MS,
  UNDO_MS,
} from '@shared/constants';
import { logger } from '@shared/logger';
import type { Ack, ContentRpcType, NewPin, RpcPayload, RpcResult, TabStatus } from '@shared/rpc';
import { DEFAULT_SETTINGS, isThreadUrl, type Pin, type Settings } from '@shared/schema';
import type { HostAdapter } from '@content/adapters/types';
import { createHighlighter } from '@content/inject/highlight';
import { createButtonManager } from './buttons';
import { evaluateHealth, HEALTHY, sameHealth } from './health';
import { createIdentity } from './identity';
import { createNavigator } from './navigator';
import { createObserver, type Budget } from './observer';
import { watchPage } from './page-watch';
import { createStateStore, type EngineState, type PinView, type ToastAction, type ToastKind } from './state';
import { RpcCallError, type StoreProxy } from './store-proxy';
import { turnOf } from './turn';
import { createThreadWatcher, isTransient, sessionNonce, type ThreadChange } from './thread';

const log = logger('engine');

export interface EngineDeps {
  adapter: HostAdapter;
  proxy: Pick<StoreProxy, 'call'>;
  /** Fixed, pointer-events:none layer inside our shadow root (highlight + floating buttons). */
  layer: HTMLElement;
  /** Display label for the host, e.g. its hostname. */
  hostLabel: string;
  /** True when the registry fell back to generic discovery. */
  fallback?: boolean;
  /** Selector tier report from the adapter's selector set, for drift detection. */
  tierReport?: () => Record<string, number | null>;
  hotkeyHint?: string;
  now?: () => number;
  loc?: () => Location;
}

function newPinId(now: number): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const rand = [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6);
  return `${now.toString(36)}${rand}`;
}

/** Strip the worker-assigned fields so a pin can be re-added (undo, promotion). */
function toNewPin(pin: Pin): NewPin {
  return {
    pinId: pin.pinId,
    targetHash: pin.targetHash,
    nativeId: pin.nativeId,
    role: pin.role,
    snippet: pin.snippet,
    textLength: pin.textLength,
    ordinal: pin.ordinal,
    label: pin.label,
    createdAt: pin.createdAt,
  };
}

function media(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

export function createEngine(deps: EngineDeps) {
  const { adapter, proxy, layer } = deps;
  const now = deps.now ?? (() => Date.now());
  const loc = deps.loc ?? (() => location);
  const nonce = sessionNonce();

  const state = createStateStore<EngineState>({
    status: 'booting',
    hostId: adapter.id,
    hostLabel: deps.hostLabel,
    threadId: null,
    transient: false,
    pins: [],
    threads: [],
    health: HEALTHY,
    storage: null,
    settings: { ...DEFAULT_SETTINGS },
    toast: null,
    sidebarOpen: false,
    focusFilterTick: 0,
    firstRunAnchor: null,
    announcement: null,
    hostModal: false,
    fullscreen: false,
    dir: 'ltr',
  });

  const settings = (): Settings => state.get().settings;
  const reducedMotion = (): boolean =>
    settings().reducedMotion === 'on' || (settings().reducedMotion === 'auto' && media('(prefers-reduced-motion: reduce)'));
  const dark = (): boolean =>
    settings().theme === 'dark' || (settings().theme === 'auto' && media('(prefers-color-scheme: dark)'));

  const identity = createIdentity(adapter);
  const highlighter = createHighlighter(layer);
  const buttons = createButtonManager(
    adapter,
    layer,
    { dark, reducedMotion, hotkeyHint: deps.hotkeyHint ?? 'Alt+Shift+P' },
    (node) => void togglePinForNode(node),
  );
  function turnBlock(node: HTMLElement): HTMLElement[] {
    const turn = turnOf(adapter.listMessageNodes(), node, (n) => adapter.getRole(n));
    const rows = turn.map((n) => adapter.getActionBarMount(n)?.container).filter((c): c is HTMLElement => !!c);
    return [...turn, ...rows];
  }
  const navigator = createNavigator({
    adapter,
    identity,
    reconcile: () => reconcileAll(),
    // Ring the whole exchange the pin belongs to: its prompt and every reply up to the next
    // prompt, including action rows hosts render beside the message node (D-022).
    highlight: (node) =>
      highlighter.show(turnBlock(node), adapter.getScrollContainer(), {
        durationMs: settings().highlightMs,
        reducedMotion: reducedMotion(),
        dark: dark(),
      }),
    clearHighlight: () => highlighter.clear(),
    reducedMotion,
    onPhase: (phase) => {
      if (phase === 'locating' && navTarget) setNav(navTarget, 'locating');
    },
  });
  /** Pin currently being navigated to, for the "locating…" card state. */
  let navTarget: string | null = null;

  let pins: Pin[] = [];
  /** Bumped on every local pin mutation; a slow wholesale reply must not undo a newer one. */
  let localSeq = 0;
  /** Nodes deferred because they were still streaming. */
  let pending = new Set<HTMLElement>();
  /** Pin intents queued while their target was streaming (EDGE_CASES.md §1). */
  const queuedPins = new Set<HTMLElement>();
  let navStates = new Map<string, Pick<PinView, 'nav' | 'notFoundReason'>>();
  let inView = new Set<string>();
  let visibility: IntersectionObserver | null = null;
  let observer = createObserver({ onBatch: reconcile, onFatal: onAdapterFatal });
  let watcher: ReturnType<typeof createThreadWatcher> | null = null;
  let bootedAt = now();
  let adapterFailed = false;
  let stopped = false;
  let undo: { pin: Pin; orderedIds: string[]; timer: ReturnType<typeof setTimeout> } | null = null;
  let toastSeq = 0;
  let announceSeq = 0;
  let unwatchPage: (() => void) | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let firstRunTimer: ReturnType<typeof setTimeout> | null = null;
  let rootWait: ReturnType<typeof setTimeout> | null = null;

  // ------------------------------------------------------------------ helpers

  function threadId(): string | null {
    return state.get().threadId;
  }

  function toast(kind: ToastKind, text: string, action: ToastAction | null = null): void {
    if (toastTimer !== null) clearTimeout(toastTimer);
    const id = ++toastSeq;
    state.set({ toast: { id, kind, text, action } });
    toastTimer = setTimeout(() => {
      toastTimer = null;
      if (state.get().toast?.id === id) state.set({ toast: null });
    }, action ? TOAST_ACTION_MS : TOAST_MS);
  }

  function announce(text: string): void {
    state.set({ announcement: { id: ++announceSeq, text } });
  }

  function handleRpcError(err: unknown, what: string): void {
    if (err instanceof RpcCallError) {
      if (err.code === 'VERSION_MISMATCH') {
        teardown();
        state.set({ status: 'version-mismatch' });
        toast('danger', 'Extension updated — reload this tab.', 'reload');
        return;
      }
      if (err.code === 'QUOTA_EXCEEDED') {
        toast('danger', "Storage full — new pins can't be saved.", 'export');
        void refreshStorage();
        return;
      }
      if (err.code === 'READ_ONLY') {
        toast('danger', 'Your pins were saved by a newer version. Update the extension to edit them.');
        return;
      }
    }
    log.warn(what, err);
    toast('danger', `Couldn't ${what}. Try again.`);
  }

  function pinnedNodeFor(pin: Pin): HTMLElement | null {
    return identity.resolve(pin, { fuzzy: false })?.node ?? null;
  }

  function publishPins(): void {
    const hashes = identity.resolvableHashes();
    const views: PinView[] = [...pins]
      .sort((a, b) => a.order - b.order)
      .map((pin) => {
        const r = identity.resolve(pin, { fuzzy: false });
        const nav = navStates.get(pin.pinId);
        return {
          pin,
          duplicate: r?.duplicate ?? false,
          resolvable: hashes.has(pin.targetHash) || r !== null,
          inView: inView.has(pin.pinId),
          nav: nav?.nav ?? 'idle',
          notFoundReason: nav?.notFoundReason ?? null,
        };
      });
    state.set({ pins: views });
  }

  function syncButtonStates(nodes: readonly HTMLElement[] = adapter.listMessageNodes()): void {
    const pinned = new Set<HTMLElement>();
    for (const pin of pins) {
      const node = pinnedNodeFor(pin);
      if (node) pinned.add(node);
    }
    for (const node of nodes) {
      if (!node.hasAttribute('data-pinpoint-indexed')) continue;
      buttons.setState(node, queuedPins.has(node) ? 'busy' : pinned.has(node) ? 'pinned' : 'unpinned');
    }
    observeVisibility(pinned);
  }

  function observeVisibility(pinnedNodes: Set<HTMLElement>): void {
    if (typeof IntersectionObserver !== 'function') return;
    visibility?.disconnect();
    const pinOfNode = new Map<Element, string>();
    for (const pin of pins) {
      const node = pinnedNodeFor(pin);
      if (node && pinnedNodes.has(node)) pinOfNode.set(node, pin.pinId);
    }
    visibility = new IntersectionObserver((entries) => {
      const next = new Set(inView);
      for (const e of entries) {
        const id = pinOfNode.get(e.target);
        if (!id) continue;
        if (e.isIntersecting) next.add(id);
        else next.delete(id);
      }
      inView = next;
      publishPins();
    });
    for (const node of pinOfNode.keys()) visibility.observe(node);
  }

  // ---------------------------------------------------------------- reconcile

  /** One budgeted reconcile slice (ARCHITECTURE.md §5). Returns true when complete. */
  function reconcile(budget: Budget): boolean {
    if (stopped || state.get().status !== 'running') return true;
    const nodes = adapter.listMessageNodes();
    const nextPending = new Set<HTMLElement>();
    let outOfTime = false;
    let progressed = false;
    for (const [i, node] of nodes.entries()) {
      if (node.dataset['pinpointIndexed'] === '1') continue;
      // Always index at least one node per slice, or a slow listing starves reconcile.
      if (outOfTime || (progressed && budget.timeLeft() <= 0)) {
        outOfTime = true;
        nextPending.add(node);
        continue;
      }
      if (adapter.isStreaming?.(node)) {
        node.dataset['pinpointStreaming'] = '1';
        nextPending.add(node);
        continue;
      }
      delete node.dataset['pinpointStreaming'];
      identity.compute(node, i); // warms the text cache — the expensive part
      node.dataset['pinpointIndexed'] = '1';
      progressed = true;
    }
    identity.rebuildIndex(nodes, nextPending);
    let inRows = 0;
    for (const node of nodes) {
      const meta = identity.meta(node);
      if (!meta) continue;
      if (buttons.ensure(node, meta.hash, 'unpinned')) inRows++;
    }
    buttons.prune();
    pending = nextPending;
    syncButtonStates(nodes);
    completeQueuedPins();
    publishPins();
    updateHealth(nodes.length, inRows);
    maybeFirstRun(nodes);
    const streaming = [...pending].some((n) => n.dataset['pinpointStreaming'] === '1');
    if (streaming) observer.schedule(STREAM_RECHECK_MS);
    return !outOfTime;
  }

  /** Synchronous full reconcile (navigation recovery, boot). */
  function reconcileAll(): void {
    reconcile({ timeLeft: () => Number.POSITIVE_INFINITY });
  }

  function updateHealth(messageNodes: number, actionBarMounts: number): void {
    const tiers = deps.tierReport?.() ?? {};
    const drift = Object.values(tiers).some((t) => t === 4);
    const next = evaluateHealth({
      probe: {
        scrollContainer: true,
        observerRoot: true,
        messageNodes,
        actionBarMounts,
        threadId: !state.get().transient,
        nativeIds: false,
      },
      transient: state.get().transient,
      fallback: deps.fallback ?? false,
      drift,
      elapsedMs: now() - bootedAt,
      adapterFailed,
    });
    if (!sameHealth(next, state.get().health)) state.set({ health: next });
  }

  function onAdapterFatal(err: unknown): void {
    log.error('adapter failing repeatedly; disabling', err);
    adapterFailed = true;
    tearDownThread();
    state.set({ health: { ...state.get().health, state: 'disabled:adapter-error' } });
  }

  function maybeFirstRun(nodes: readonly HTMLElement[]): void {
    if (settings().firstRunDone || state.get().firstRunAnchor || firstRunTimer !== null) return;
    const node = nodes.find((n) => buttons.buttonFor(n)?.isConnected);
    const btn = node ? buttons.buttonFor(node) : undefined;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    state.set({ firstRunAnchor: { x: r.left + r.width / 2, y: r.bottom } });
    firstRunTimer = setTimeout(() => void dismissFirstRun(), FIRST_RUN_TOOLTIP_MS);
  }

  async function dismissFirstRun(): Promise<void> {
    if (firstRunTimer !== null) clearTimeout(firstRunTimer);
    firstRunTimer = null;
    state.set({ firstRunAnchor: null });
    if (settings().firstRunDone) return;
    await updateSettings({ firstRunDone: true });
  }

  // --------------------------------------------------------------------- pins

  async function loadPins(): Promise<void> {
    const id = threadId();
    if (!id || isTransient(id)) return;
    const seq = localSeq;
    try {
      const listed = await proxy.call('pins:list', { hostId: adapter.id, threadId: id });
      if (seq !== localSeq || threadId() !== id) return; // superseded; a broadcast follows
      pins = listed;
    } catch (err) {
      handleRpcError(err, 'load pins'); // keep what is shown; never blank the list on a hiccup
    }
    navStates = new Map();
    syncButtonStates();
    publishPins();
  }

  function threadMeta(): { title: string | null; url: string } {
    return { title: adapter.getThreadTitle?.() ?? null, url: loc().href };
  }

  async function addPin(newPin: NewPin): Promise<Pin | null> {
    const id = threadId();
    if (!id) return null;
    if (isTransient(id)) {
      const order = pins.reduce((m, p) => Math.max(m, p.order), 0) + ORDER_STEP;
      const pin: Pin = { ...newPin, order, updatedAt: newPin.createdAt, repairCount: 0 };
      pins = [...pins, pin];
      return pin;
    }
    try {
      const pin = await proxy.call('pins:add', { hostId: adapter.id, threadId: id, pin: newPin, thread: threadMeta() });
      localSeq++;
      pins = [...pins.filter((p) => p.pinId !== pin.pinId), pin];
      return pin;
    } catch (err) {
      handleRpcError(err, 'save the pin');
      return null;
    }
  }

  async function pinNode(node: HTMLElement): Promise<void> {
    if (state.get().storage?.readOnly) {
      toast('danger', 'Your pins were saved by a newer version. Update the extension to edit them.');
      return;
    }
    const desc = identity.describe(node, settings().snippetChars);
    if (!desc) {
      queuedPins.add(node);
      buttons.setState(node, 'busy');
      return;
    }
    const pin = await addPin({ ...desc, pinId: newPinId(now()), label: null, createdAt: now() });
    if (!pin) return;
    syncButtonStates();
    publishPins();
    toast('success', 'Pinned');
    announce('Pinned');
  }

  function completeQueuedPins(): void {
    for (const node of [...queuedPins]) {
      if (!node.isConnected) {
        queuedPins.delete(node);
        continue;
      }
      if (identity.meta(node)) {
        queuedPins.delete(node);
        void pinNode(node);
      }
    }
  }

  async function removePin(pinId: string, withUndo: boolean): Promise<void> {
    const pin = pins.find((p) => p.pinId === pinId);
    const id = threadId();
    if (!pin || !id) return;
    const orderedIds = [...pins].sort((a, b) => a.order - b.order).map((p) => p.pinId);
    localSeq++;
    pins = pins.filter((p) => p.pinId !== pinId);
    syncButtonStates();
    publishPins();
    if (!isTransient(id)) {
      try {
        await proxy.call('pins:remove', { hostId: adapter.id, threadId: id, pinId });
      } catch (err) {
        pins = [...pins, pin];
        syncButtonStates();
        publishPins();
        handleRpcError(err, 'unpin');
        return;
      }
    }
    if (withUndo) {
      if (undo) clearTimeout(undo.timer);
      undo = { pin, orderedIds, timer: setTimeout(() => (undo = null), UNDO_MS) };
      toast('neutral', 'Unpinned', 'undo');
    }
    announce('Unpinned');
  }

  async function undoUnpin(): Promise<void> {
    if (!undo) return;
    const { pin, orderedIds, timer } = undo;
    clearTimeout(timer);
    undo = null;
    const restored = await addPin(toNewPin(pin));
    if (!restored) return;
    await reorder(orderedIds);
    toast('success', 'Restored');
  }

  async function togglePinForNode(node: HTMLElement): Promise<void> {
    const existing = pins.filter((p) => pinnedNodeFor(p) === node);
    if (existing.length > 0) {
      for (const p of existing) await removePin(p.pinId, true);
      return;
    }
    await pinNode(node);
  }

  async function rename(pinId: string, label: string | null): Promise<void> {
    const id = threadId();
    if (!id) return;
    if (isTransient(id)) {
      pins = pins.map((p) => (p.pinId === pinId ? { ...p, label: label?.trim() || null } : p));
      publishPins();
      return;
    }
    try {
      const pin = await proxy.call('pins:update', { hostId: adapter.id, threadId: id, pinId, patch: { label } });
      pins = pins.map((p) => (p.pinId === pinId ? pin : p));
      publishPins();
    } catch (err) {
      handleRpcError(err, 'rename the pin');
    }
  }

  async function reorder(orderedIds: string[]): Promise<void> {
    const id = threadId();
    if (!id) return;
    const rank = new Map(orderedIds.map((pid, i) => [pid, i]));
    const local = [...pins].sort(
      (a, b) => (rank.get(a.pinId) ?? Infinity) - (rank.get(b.pinId) ?? Infinity) || a.order - b.order,
    );
    pins = local.map((p, i) => ({ ...p, order: (i + 1) * ORDER_STEP }));
    const seq = ++localSeq;
    publishPins();
    if (isTransient(id)) return;
    try {
      const server = await proxy.call('pins:reorder', { hostId: adapter.id, threadId: id, orderedIds });
      if (seq !== localSeq) return; // a newer local change (e.g. an unpin) already applies
      pins = server;
      publishPins();
    } catch (err) {
      handleRpcError(err, 'reorder pins');
      await loadPins();
    }
  }

  // --------------------------------------------------------------- navigation

  function setNav(pinId: string, nav: PinView['nav'], reason: PinView['notFoundReason'] = null): void {
    navStates = new Map(navStates).set(pinId, { nav, notFoundReason: reason });
    publishPins();
  }

  async function navigate(pinId: string): Promise<void> {
    const pin = pins.find((p) => p.pinId === pinId);
    if (!pin) return;
    for (const [other, s] of navStates) if (s.nav !== 'idle' && other !== pinId) setNav(other, 'idle');
    navTarget = pinId;
    const result = await navigator.goTo(pin).catch((err: unknown) => {
      log.warn('navigation failed', err);
      return { status: 'not-found' as const, reason: 'exhausted' as const };
    });
    if (navTarget === pinId) navTarget = null;
    if (result.status === 'found') {
      setNav(pinId, 'idle');
      announce(`Jumped to ${pin.role === 'unknown' ? '' : `${pin.role} `}message`);
      if (identity.needsRepair(pin, result.resolution)) void repair(pin, result.resolution.meta.hash);
    } else if (result.status === 'not-found') {
      setNav(pinId, 'not-found', result.reason);
      announce("Couldn't find that message");
    } else {
      setNav(pinId, 'idle');
    }
  }

  async function repair(pin: Pin, newHash: string): Promise<void> {
    const id = threadId();
    if (!id) return;
    if (isTransient(id)) {
      pins = pins.map((p) => (p.pinId === pin.pinId ? { ...p, targetHash: newHash, repairCount: p.repairCount + 1 } : p));
      return;
    }
    try {
      const updated = await proxy.call('pins:repairHash', { hostId: adapter.id, threadId: id, pinId: pin.pinId, newHash });
      pins = pins.map((p) => (p.pinId === pin.pinId ? updated : p));
      publishPins();
    } catch (err) {
      log.debug('repair failed (best effort)', err);
    }
  }

  // ------------------------------------------------------------------ threads

  function tearDownThread(): void {
    navigator.abort();
    observer.stop();
    highlighter.clear();
    visibility?.disconnect();
    visibility = null;
    buttons.destroy();
    identity.clear();
    pending = new Set();
    queuedPins.clear();
    inView = new Set();
    if (rootWait !== null) clearTimeout(rootWait);
    rootWait = null;
  }

  async function promote(fromThread: string, transientPins: Pin[]): Promise<void> {
    const id = threadId();
    if (!id || isTransient(id)) return;
    for (const pin of [...transientPins].sort((a, b) => a.order - b.order)) {
      try {
        await proxy.call('pins:add', { hostId: adapter.id, threadId: id, pin: toNewPin(pin), thread: threadMeta() });
      } catch (err) {
        handleRpcError(err, 'save pins for this chat');
        return;
      }
    }
    log.debug('promoted transient pins', fromThread, '→', id, transientPins.length);
  }

  async function onThreadChange(change: ThreadChange): Promise<void> {
    const carried = change.fromTransient && pins.length > 0 && adapter.listMessageNodes().some((n) => identity.meta(n));
    const transientPins = carried ? pins : [];
    tearDownThread();
    pins = [];
    state.set({ threadId: change.next, transient: isTransient(change.next), threads: [] });
    if (carried) await promote(change.previous, transientPins);
    await attachThread();
  }

  /** Wait for the observer root, then load pins, observe, and reconcile. */
  async function attachThread(): Promise<void> {
    if (stopped) return;
    bootedAt = now();
    observer = createObserver({ onBatch: reconcile, onFatal: onAdapterFatal });
    const root = await waitForRoot();
    if (stopped) return;
    await loadPins();
    if (!root) {
      updateHealth(0, 0);
      return;
    }
    observer.start(root);
    observer.runNow();
  }

  function waitForRoot(): Promise<HTMLElement | null> {
    const deadline = now() + OBSERVER_ROOT_TIMEOUT_MS;
    return new Promise((resolve) => {
      const poll = (): void => {
        rootWait = null;
        if (stopped) return resolve(null);
        const root = adapter.getObserverRoot();
        if (root) return resolve(root);
        if (now() >= deadline) return resolve(null);
        rootWait = setTimeout(poll, OBSERVER_ROOT_POLL_MS);
      };
      poll();
    });
  }

  async function refreshStorage(): Promise<void> {
    try {
      const stats = await proxy.call('storage:stats', null);
      state.set({ storage: { level: stats.level, readOnly: stats.readOnly, quarantined: stats.quarantined.length } });
    } catch (err) {
      log.debug('storage stats unavailable', err);
    }
  }

  async function loadThreads(): Promise<void> {
    try {
      state.set({ threads: await proxy.call('threads:list', { hostId: adapter.id }) });
    } catch (err) {
      handleRpcError(err, 'load your chats');
    }
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    state.set({ settings: { ...settings(), ...patch } });
    try {
      state.set({ settings: await proxy.call('settings:set', patch) });
    } catch (err) {
      handleRpcError(err, 'save settings');
    }
  }

  // ---------------------------------------------------------------- lifecycle

  function teardown(): void {
    tearDownThread();
    watcher?.stop();
    watcher = null;
    if (undo) clearTimeout(undo.timer);
    undo = null;
    if (toastTimer !== null) clearTimeout(toastTimer);
    if (firstRunTimer !== null) clearTimeout(firstRunTimer);
    unwatchPage?.();
    unwatchPage = null;
    toastTimer = null;
    firstRunTimer = null;
    highlighter.destroy();
  }

  async function start(): Promise<void> {
    stopped = false;
    try {
      state.set({ settings: await proxy.call('settings:get', null) });
    } catch (err) {
      handleRpcError(err, 'load settings');
      if (state.get().status === 'version-mismatch') return;
    }
    if (!settings().hosts[adapter.id].enabled) {
      state.set({ status: 'disabled' });
      return;
    }
    state.set({ sidebarOpen: !settings().startCollapsed });
    unwatchPage = watchPage((c) => state.set(c));
    watcher = createThreadWatcher({ adapter, nonce, onChange: (c) => void onThreadChange(c), loc });
    const id = watcher.current();
    state.set({ status: 'running', threadId: id, transient: isTransient(id) });
    watcher.start();
    void refreshStorage();
    await attachThread();
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    teardown();
    state.set({ status: 'stopped', pins: [], toast: null, firstRunAnchor: null });
  }

  /** Last assistant message (or last message) for the pin-last hotkey. */
  function lastMessage(): HTMLElement | null {
    const nodes = adapter.listMessageNodes();
    return [...nodes].reverse().find((n) => adapter.getRole(n) === 'assistant') ?? nodes[nodes.length - 1] ?? null;
  }

  function nodeForSelection(text: string): HTMLElement | null {
    const nodes = adapter.listMessageNodes();
    const anchor = typeof getSelection === 'function' ? getSelection()?.anchorNode ?? null : null;
    if (anchor) {
      const hit = nodes.find((n) => n.contains(anchor));
      if (hit) return hit;
    }
    const needle = text.replace(/\s+/g, ' ').trim();
    if (!needle) return null;
    return nodes.find((n) => (identity.meta(n)?.text ?? adapter.getText(n)).includes(needle)) ?? null;
  }

  async function pinLast(): Promise<void> {
    const node = lastMessage();
    if (node) await pinNode(node);
  }

  /** Apply settings from any context; a host toggle tears down or re-boots live (EDGE_CASES §22). */
  function applySettings(next: Settings): void {
    const wasEnabled = settings().hosts[adapter.id].enabled;
    const enabled = next.hosts[adapter.id].enabled;
    state.set({ settings: next });
    const status = state.get().status;
    if (wasEnabled && !enabled && status === 'running') {
      teardown();
      pins = [];
      state.set({ status: 'disabled', pins: [], toast: null, firstRunAnchor: null });
    } else if (!wasEnabled && enabled && status === 'disabled') {
      void start();
    } else if (status === 'running') {
      syncButtonStates();
    }
  }

  function tabStatus(): TabStatus {
    const s = state.get();
    return { hostId: s.hostId, status: s.status, threadId: s.threadId, transient: s.transient, pinCount: s.pins.length };
  }

  /** Handle a worker/popup message; returns the RPC result for that message type. */
  function handleMessage<T extends ContentRpcType>(type: T, payload: RpcPayload<T>): RpcResult<ContentRpcType> {
    const ack: Ack = { ack: true };
    if (type === 'ui:status') return tabStatus();
    if (stopped) return ack;
    if (type === 'settings:changed') {
      applySettings(payload as RpcPayload<'settings:changed'>);
      return null;
    }
    if (state.get().status !== 'running') return ack;
    switch (type) {
      case 'ui:openSidebar':
        state.set({ sidebarOpen: true });
        break;
      case 'store:changed': {
        const ref = payload as RpcPayload<'store:changed'>;
        if (ref.hostId === adapter.id && ref.threadId === threadId()) void loadPins();
        if (state.get().threads.length > 0) void loadThreads();
        break;
      }
      case 'command:pinLast':
        void pinLast();
        break;
      case 'command:toggleSidebar':
        state.set({ sidebarOpen: !state.get().sidebarOpen });
        break;
      case 'command:focusFilter':
        state.set({ sidebarOpen: true, focusFilterTick: state.get().focusFilterTick + 1 });
        break;
      case 'menu:pinSelection': {
        const node = nodeForSelection((payload as RpcPayload<'menu:pinSelection'>).selectionText);
        if (node) void pinNode(node);
        else toast('danger', "Couldn't find the message for that selection.");
        break;
      }
      default:
        break;
    }
    return type === 'store:changed' ? null : ack;
  }

  return {
    state,
    start,
    stop,
    handleMessage,
    intents: {
      pinNode,
      pinLast,
      unpin: (pinId: string) => removePin(pinId, true),
      undo: undoUnpin,
      navigate,
      rename,
      reorder,
      loadThreads,
      openThread: (url: string) => {
        if (isThreadUrl(url)) loc().assign(url);
      },
      setSidebarOpen: (open: boolean) => state.set({ sidebarOpen: open }),
      toggleSidebar: () => state.set({ sidebarOpen: !state.get().sidebarOpen }),
      updateSettings,
      dismissToast: () => state.set({ toast: null }),
      dismissFirstRun,
      retry: async () => {
        adapterFailed = false;
        tearDownThread();
        state.set({ health: HEALTHY });
        await attachThread();
      },
    },
    /** Test/diagnostic access. */
    internals: { identity, buttons, observer: () => observer, pins: () => pins, reconcileAll },
  };
}

export type Engine = ReturnType<typeof createEngine>;
