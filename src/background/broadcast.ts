/**
 * Worker → content-script messages. Tabs are found by the manifest's own content-script
 * patterns, so the worker names no host (I1) and needs no `tabs` permission (R13): host
 * permissions allow url-filtered tabs.query and tabs.sendMessage on matching tabs.
 */
import { RPC_PROTOCOL, type ContentRpcType, type RpcPayload, type RpcRequest } from '@shared/rpc';

let sequence = 0;

export function contentPatterns(): string[] {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  return [...new Set(scripts.flatMap((s) => s.matches ?? []))];
}

export function makeContentMessage<K extends ContentRpcType>(
  type: K,
  payload: RpcPayload<K>,
): RpcRequest<K> {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  return { protocol: RPC_PROTOCOL, type, requestId: `sw-${sequence}`, payload } as RpcRequest<K>;
}

/** Sends to every tab on a supported host. Tabs without a live content script are skipped. */
export async function sendToHostTabs<K extends ContentRpcType>(
  type: K,
  payload: RpcPayload<K>,
): Promise<void> {
  const tabs = await chrome.tabs.query({ url: contentPatterns() });
  const message = makeContentMessage(type, payload);
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? Promise.resolve()
        : chrome.tabs.sendMessage(tab.id, message).catch(() => undefined),
    ),
  );
}
