// src/content/adapters/types.ts — the adapter contract (ARCHITECTURE.md §3, verbatim).
import type { HostId } from '@shared/schema';

export type { HostId };

export interface HostAdapter {
  /** Stable key used in storage and logs: 'gemini' | 'chatgpt' | 'claude' | 'generic' */
  readonly id: HostId;

  /** Does this adapter handle the current location? */
  matches(loc: Location): boolean;

  /** Scrollable element that contains the conversation. Null if not ready yet. */
  getScrollContainer(): HTMLElement | null;

  /** Element whose subtree mutations indicate new/changed messages. */
  getObserverRoot(): HTMLElement | null;

  /** All currently-rendered message nodes, in document order. */
  listMessageNodes(): HTMLElement[];

  /** Classify a message node. */
  getRole(node: HTMLElement): 'user' | 'assistant' | 'unknown';

  /** Host-native stable id for this node, if one exists. */
  getNativeId(node: HTMLElement): string | null;

  /** Plain text of the message, normalised, for snippet + hashing. */
  getText(node: HTMLElement): string;

  /** Where the pin button should be appended, and how. */
  getActionBarMount(node: HTMLElement): MountPoint | null;

  /** Thread identifier from the URL/DOM, or null when indeterminate. */
  getThreadId(loc: Location): string | null;

  /** Optional: human-readable thread title for the cross-thread index. */
  getThreadTitle?(): string | null;

  /** Is the message still streaming? Pinning waits for completion. */
  isStreaming?(node: HTMLElement): boolean;

  /** Optional host-specific recovery hook (e.g. click "load earlier"). */
  requestOlderMessages?(): Promise<boolean>;

  /** Self-check used by health.ts: which capabilities currently resolve. */
  probe(): AdapterProbeResult;
}

export interface MountPoint {
  container: HTMLElement;
  position: 'append' | 'prepend' | 'before' | 'after';
  /** Reference node when position is before/after. */
  anchor?: HTMLElement;
  /** Extra class/style hints so the button visually matches the host. */
  styleHint?: 'icon-ghost' | 'icon-solid' | 'floating';
}

export interface AdapterProbeResult {
  scrollContainer: boolean;
  observerRoot: boolean;
  messageNodes: number;
  actionBarMounts: number;
  threadId: boolean;
  nativeIds: boolean;
}
