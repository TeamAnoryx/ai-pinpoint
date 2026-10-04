/**
 * Host display metadata for the popup and options page. Pure data — host names may only
 * appear under adapters/ (CLAUDE.md R2), so UI pages import labels from here.
 */
import type { HostId } from './types';

export interface HostMeta {
  label: string;
  origins: readonly string[];
}

export const HOST_META: Readonly<Record<HostId, HostMeta>> = {
  gemini: { label: 'Gemini', origins: ['https://gemini.google.com'] },
  chatgpt: { label: 'ChatGPT', origins: ['https://chatgpt.com', 'https://chat.openai.com'] },
  claude: { label: 'Claude', origins: ['https://claude.ai'] },
  generic: { label: 'Other', origins: [] },
};

/** Hosts a user can toggle (generic is a fallback, never a destination). */
export const TOGGLEABLE_HOSTS: readonly HostId[] = ['gemini', 'chatgpt', 'claude'];
