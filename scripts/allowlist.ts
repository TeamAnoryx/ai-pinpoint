/** Single allowlist shared by the verifiers (TECH_STACK.md §3, §7). */

/** The only origins the extension may name. Matches manifest host_permissions. */
export const HOST_ORIGINS = [
  'https://gemini.google.com',
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://claude.ai',
] as const;

export const HOST_PATTERNS: readonly string[] = HOST_ORIGINS.map((origin) => `${origin}/*`);

/**
 * XML namespace identifiers. They look like URLs but are never fetched; Preact and our own
 * createElementNS calls need them to build SVG without innerHTML (D-008).
 */
export const NAMESPACE_URIS = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/XML/1998/namespace',
] as const;

/** Display-only text shown in the options page. */
export const DISPLAY_URLS = ['chrome://extensions/shortcuts'] as const;

export const ALLOWED_PERMISSIONS = ['storage', 'contextMenus'] as const;

export const FORBIDDEN_PERMISSIONS = [
  'tabs',
  'activeTab',
  'scripting',
  'webRequest',
  'webRequestBlocking',
  'declarativeNetRequest',
  'unlimitedStorage',
  'clipboardRead',
  '<all_urls>',
] as const;
