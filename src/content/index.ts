/**
 * Content script entry (ARCHITECTURE.md §4): resolve the adapter, mount the overlay, start
 * the engine, route worker messages, and tear everything down on pagehide. Must stay a
 * single chunk: no dynamic import() (TECH_STACK.md §8).
 */
import { logger } from '@shared/logger';
import { isContentRpcType, isRpcEnvelope, RPC_PROTOCOL, type ContentRpcType, type RpcPayload } from '@shared/rpc';
import { isFallback, resolve } from '@content/adapters/registry';
import { createEngine } from '@content/core/engine';
import { createStoreProxy } from '@content/core/store-proxy';
import { mountOverlay } from '@content/overlay/mount';

const log = logger('content');

function boot(): void {
  const adapter = resolve(location);
  const proxy = createStoreProxy();
  const overlay = mountOverlay();
  const engine = createEngine({
    adapter,
    proxy,
    layer: overlay.layer,
    hostLabel: location.hostname,
    fallback: isFallback(adapter),
  });
  overlay.attach(engine, {
    openOptions: () => {
      proxy.call('ui:openOptions', null).catch((err: unknown) => log.warn('open options failed', err));
    },
    copyText: (text) => navigator.clipboard.writeText(text),
  });

  const onMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (sender.id !== chrome.runtime.id || !isRpcEnvelope(message)) return false;
    if (message.protocol !== RPC_PROTOCOL || !isContentRpcType(message.type)) return false;
    try {
      const data = engine.handleMessage(message.type as ContentRpcType, message.payload as RpcPayload<ContentRpcType>);
      sendResponse({ requestId: message.requestId, ok: true, data });
    } catch (err) {
      log.error('message handling failed', err);
      sendResponse({ requestId: message.requestId, ok: false, error: { code: 'INTERNAL', message: 'Content script error.' } });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  const shutdown = (): void => {
    chrome.runtime.onMessage.removeListener(onMessage);
    engine.stop();
    overlay.destroy();
  };
  addEventListener('pagehide', shutdown, { once: true });

  engine.start().catch((err: unknown) => {
    log.error('boot failed', err);
    shutdown();
  });
}

function safeBoot(): void {
  try {
    boot();
  } catch (err) {
    log.error('content script failed to boot', err);
  }
}

safeBoot();
// A page restored from the back/forward cache fired pagehide (full teardown): boot again.
addEventListener('pageshow', (e) => {
  if (e.persisted) safeBoot();
});
