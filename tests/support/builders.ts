import type { NewPin, ThreadMeta, ThreadRef } from '@shared/rpc';

export const REF: ThreadRef = { hostId: 'claude', threadId: 'claude:thread-1' };
export const META: ThreadMeta = { title: 'Thread one', url: 'https://example.test/chat/thread-1' };

let n = 0;
export function newPin(overrides: Partial<NewPin> = {}): NewPin {
  n++;
  return {
    pinId: `pin-${n.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    targetHash: `c:${n.toString(36)}:1`,
    nativeId: null,
    role: 'assistant',
    snippet: `snippet ${n}`,
    textLength: 100 + n,
    ordinal: n,
    label: null,
    createdAt: 1_700_000_000_000 + n,
    ...overrides,
  };
}

export function ref(threadId: string, hostId: ThreadRef['hostId'] = 'claude'): ThreadRef {
  return { hostId, threadId };
}

export function meta(threadId: string): ThreadMeta {
  return { title: `Title ${threadId}`, url: `https://example.test/chat/${threadId}` };
}
