/**
 * Namespaced logger, compiled out of production builds via `__DEV__` (TECH_STACK.md §8).
 * In dev, pages enable it with `localStorage['pp:debug'] = '1'`; the service worker has no
 * localStorage and always logs in dev builds (D-005).
 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const DEBUG_FLAG = 'pp:debug';

function enabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(DEBUG_FLAG) === '1';
  } catch {
    return false;
  }
}

export function logger(namespace: string): Logger {
  const tag = `[pinpoint:${namespace}]`;
  return {
    debug(...args) {
      if (__DEV__ && enabled()) console.debug(tag, ...args);
    },
    info(...args) {
      if (__DEV__ && enabled()) console.info(tag, ...args);
    },
    warn(...args) {
      if (__DEV__ && enabled()) console.warn(tag, ...args);
    },
    error(...args) {
      if (__DEV__ && enabled()) console.error(tag, ...args);
    },
  };
}
