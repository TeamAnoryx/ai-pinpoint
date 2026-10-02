/**
 * Storage types and hand-written validators (DATA_MODEL.md §2, TECH_STACK.md §1: no zod).
 *
 * Every validator: checks types, clamps numeric ranges, clamps free-text lengths, rejects
 * over-limit arrays, strips unknown keys, and returns a Result. Validators never throw.
 */
import {
  DEFAULT_SNIPPET_CHARS,
  HIGHLIGHT_MS,
  HIGHLIGHT_MS_MAX,
  HIGHLIGHT_MS_MIN,
  MAX_ID_CHARS,
  MAX_LABEL_CHARS,
  MAX_PINS_PER_THREAD,
  MAX_SNIPPET_CHARS,
  MAX_THREADS_PER_HOST,
  MAX_TITLE_CHARS,
  MAX_URL_CHARS,
  MAX_VERSION_CHARS,
  MIN_SNIPPET_CHARS,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from './constants';

export const SCHEMA_VERSION = 1 as const;

export const HOST_IDS = ['gemini', 'chatgpt', 'claude', 'generic'] as const;
export const ROLES = ['user', 'assistant', 'unknown'] as const;

export type HostId = (typeof HOST_IDS)[number];
export type Role = (typeof ROLES)[number];

export interface Pin {
  /** ULID-ish: base36 timestamp + 6 random chars. Sortable, no deps. */
  pinId: string;
  /** Primary identity for re-finding the message. See DATA_MODEL.md §4. */
  targetHash: string;
  /** Host-native id when available (ChatGPT message uuid, Gemini response id). */
  nativeId: string | null;
  role: Role;
  /** Normalised text, truncated. Used for preview AND fuzzy recovery. */
  snippet: string;
  /** Full normalised text length before truncation — a cheap extra identity signal. */
  textLength: number;
  /** 0-based position of the message in the thread at pin time. Recovery hint only. */
  ordinal: number;
  /** Optional user label, <= 120 chars. */
  label: string | null;
  /** Manual sort position; sparse integers (100, 200, 300...) for cheap reordering. */
  order: number;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  /** Bumped whenever recovery repairs targetHash, for diagnostics. */
  repairCount: number;
}

export interface ThreadRecord {
  schema: typeof SCHEMA_VERSION;
  hostId: HostId;
  threadId: string;
  title: string | null;
  pins: Pin[];
  createdAt: number;
  updatedAt: number;
}

export interface ThreadSummary {
  threadId: string;
  title: string | null;
  pinCount: number;
  updatedAt: number;
  /** Reconstructable URL for navigation (FR-7). */
  url: string;
}

export interface HostIndex {
  schema: typeof SCHEMA_VERSION;
  hostId: HostId;
  threads: ThreadSummary[];
}

export interface Settings {
  schema: typeof SCHEMA_VERSION;
  hosts: Record<HostId, { enabled: boolean }>;
  sidebarSide: 'left' | 'right';
  sidebarWidth: number; // px, 240–520
  theme: 'auto' | 'light' | 'dark';
  startCollapsed: boolean;
  highlightMs: number; // default 1200
  snippetChars: number; // default 140, max 400
  reducedMotion: 'auto' | 'on' | 'off';
  firstRunDone: boolean;
}

export interface StoreMeta {
  /** Not narrowed to SCHEMA_VERSION: a newer build may have written it (read-only mode). */
  schema: number;
  installedAt: number;
  lastMigratedFrom: number | null;
}

export interface ExportBundle {
  kind: 'ai-pinpoint-export';
  schema: typeof SCHEMA_VERSION;
  exportedAt: number;
  extensionVersion: string;
  settings: Settings;
  threads: ThreadRecord[];
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  schema: SCHEMA_VERSION,
  hosts: {
    gemini: { enabled: true },
    chatgpt: { enabled: true },
    claude: { enabled: true },
    generic: { enabled: true },
  },
  sidebarSide: 'right',
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  theme: 'auto',
  startCollapsed: true,
  highlightMs: HIGHLIGHT_MS,
  snippetChars: DEFAULT_SNIPPET_CHARS,
  reducedMotion: 'auto',
  firstRunDone: false,
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ValidationError {
  path: string;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

export function valueOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

// ---------------------------------------------------------------------------
// Field readers. They throw `Invalid` internally; `run` converts it to a Result,
// so nothing ever escapes a public validator.
// ---------------------------------------------------------------------------

class Invalid extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

type Obj = Record<string, unknown>;

function run<T>(read: () => T): Result<T> {
  try {
    return { ok: true, value: read() };
  } catch (err) {
    if (err instanceof Invalid)
      return { ok: false, error: { path: err.path, message: err.message } };
    return { ok: false, error: { path: '', message: 'unreadable value' } };
  }
}

function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

function record(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Invalid(path, 'expected an object');
  }
  return v as Obj;
}

/** Truncate to `max` UTF-16 units without leaving a dangling high surrogate. */
function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Free text (snippet, label, title): wrong type rejects, over-length is clamped. */
function text(o: Obj, key: string, path: string, max: number): string {
  const v = o[key];
  if (typeof v !== 'string') throw new Invalid(join(path, key), 'expected a string');
  return clampText(v, max);
}

function nullableText(o: Obj, key: string, path: string, max: number): string | null {
  return o[key] === null ? null : text(o, key, path, max);
}

/** Identifiers: truncating would change identity, so over-length or empty rejects. */
function id(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID_CHARS) {
    throw new Invalid(
      join(path, key),
      `expected a non-empty string of at most ${MAX_ID_CHARS} chars`,
    );
  }
  return v;
}

function nullableId(o: Obj, key: string, path: string): string | null {
  return o[key] === null ? null : id(o, key, path);
}

function num(o: Obj, key: string, path: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Invalid(join(path, key), 'expected a finite number');
  }
  return Math.min(max, Math.max(min, v));
}

function int(o: Obj, key: string, path: string, min: number, max: number): number {
  return Math.trunc(num(o, key, path, min, max));
}

function timestamp(o: Obj, key: string, path: string): number {
  return int(o, key, path, 0, Number.MAX_SAFE_INTEGER);
}

function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') throw new Invalid(join(path, key), 'expected a boolean');
  return v;
}

function oneOf<T extends string>(o: Obj, key: string, path: string, allowed: readonly T[]): T {
  const v = o[key];
  const match = allowed.find((a) => a === v);
  if (match === undefined) {
    throw new Invalid(join(path, key), `expected one of ${allowed.join(', ')}`);
  }
  return match;
}

function list(o: Obj, key: string, path: string, max: number): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new Invalid(join(path, key), 'expected an array');
  if (v.length > max) throw new Invalid(join(path, key), `too many entries (max ${max})`);
  return v;
}

function currentSchema(o: Obj, path: string): typeof SCHEMA_VERSION {
  const v = o['schema'];
  if (typeof v === 'number' && v > SCHEMA_VERSION) {
    throw new Invalid(join(path, 'schema'), `written by a newer version (schema ${v})`);
  }
  if (v !== SCHEMA_VERSION) {
    throw new Invalid(join(path, 'schema'), `expected schema ${SCHEMA_VERSION}`);
  }
  return SCHEMA_VERSION;
}

/** Only https URLs may be stored for navigation; imported bundles are untrusted. */
function httpsUrl(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length > MAX_URL_CHARS || !v.startsWith('https://')) {
    throw new Invalid(join(path, key), 'expected an https URL');
  }
  return v;
}

// ---------------------------------------------------------------------------
// Readers (throwing) — composed by the public validators below.
// ---------------------------------------------------------------------------

function readPin(v: unknown, path: string): Pin {
  const o = record(v, path);
  return {
    pinId: id(o, 'pinId', path),
    targetHash: id(o, 'targetHash', path),
    nativeId: nullableId(o, 'nativeId', path),
    role: oneOf(o, 'role', path, ROLES),
    snippet: text(o, 'snippet', path, MAX_SNIPPET_CHARS),
    textLength: int(o, 'textLength', path, 0, Number.MAX_SAFE_INTEGER),
    ordinal: int(o, 'ordinal', path, 0, Number.MAX_SAFE_INTEGER),
    label: nullableText(o, 'label', path, MAX_LABEL_CHARS),
    order: num(o, 'order', path, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    createdAt: timestamp(o, 'createdAt', path),
    updatedAt: timestamp(o, 'updatedAt', path),
    repairCount: int(o, 'repairCount', path, 0, Number.MAX_SAFE_INTEGER),
  };
}

function readThreadRecord(v: unknown, path: string): ThreadRecord {
  const o = record(v, path);
  const pinsPath = join(path, 'pins');
  return {
    schema: currentSchema(o, path),
    hostId: oneOf(o, 'hostId', path, HOST_IDS),
    threadId: id(o, 'threadId', path),
    title: nullableText(o, 'title', path, MAX_TITLE_CHARS),
    pins: list(o, 'pins', path, MAX_PINS_PER_THREAD).map((p, i) => readPin(p, join(pinsPath, i))),
    createdAt: timestamp(o, 'createdAt', path),
    updatedAt: timestamp(o, 'updatedAt', path),
  };
}

function readThreadSummary(v: unknown, path: string): ThreadSummary {
  const o = record(v, path);
  return {
    threadId: id(o, 'threadId', path),
    title: nullableText(o, 'title', path, MAX_TITLE_CHARS),
    pinCount: int(o, 'pinCount', path, 0, MAX_PINS_PER_THREAD),
    updatedAt: timestamp(o, 'updatedAt', path),
    url: httpsUrl(o, 'url', path),
  };
}

/** Missing settings fields fall back to defaults; present-but-wrong-typed fields reject. */
function readSettings(v: unknown, path: string): Settings {
  const o = { ...DEFAULT_SETTINGS, ...record(v, path) };
  const hostsPath = join(path, 'hosts');
  const rawHosts = record(o['hosts'], hostsPath);
  const hosts = {} as Record<HostId, { enabled: boolean }>;
  for (const hostId of HOST_IDS) {
    const entryPath = join(hostsPath, hostId);
    const entry = record(rawHosts[hostId] ?? DEFAULT_SETTINGS.hosts[hostId], entryPath);
    hosts[hostId] = { enabled: bool(entry, 'enabled', entryPath) };
  }
  return {
    schema: currentSchema(o, path),
    hosts,
    sidebarSide: oneOf(o, 'sidebarSide', path, ['left', 'right'] as const),
    sidebarWidth: int(o, 'sidebarWidth', path, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
    theme: oneOf(o, 'theme', path, ['auto', 'light', 'dark'] as const),
    startCollapsed: bool(o, 'startCollapsed', path),
    highlightMs: int(o, 'highlightMs', path, HIGHLIGHT_MS_MIN, HIGHLIGHT_MS_MAX),
    snippetChars: int(o, 'snippetChars', path, MIN_SNIPPET_CHARS, MAX_SNIPPET_CHARS),
    reducedMotion: oneOf(o, 'reducedMotion', path, ['auto', 'on', 'off'] as const),
    firstRunDone: bool(o, 'firstRunDone', path),
  };
}

// ---------------------------------------------------------------------------
// Public validators
// ---------------------------------------------------------------------------

export function validatePin(v: unknown): Result<Pin> {
  return run(() => readPin(v, ''));
}

export function validateThreadRecord(v: unknown): Result<ThreadRecord> {
  return run(() => readThreadRecord(v, ''));
}

export function validateThreadSummary(v: unknown): Result<ThreadSummary> {
  return run(() => readThreadSummary(v, ''));
}

export function validateHostIndex(v: unknown): Result<HostIndex> {
  return run(() => {
    const o = record(v, '');
    return {
      schema: currentSchema(o, ''),
      hostId: oneOf(o, 'hostId', '', HOST_IDS),
      threads: list(o, 'threads', '', MAX_THREADS_PER_HOST).map((t, i) =>
        readThreadSummary(t, join('threads', i)),
      ),
    };
  });
}

export function validateSettings(v: unknown): Result<Settings> {
  return run(() => readSettings(v, ''));
}

export function validateStoreMeta(v: unknown): Result<StoreMeta> {
  return run(() => {
    const o = record(v, '');
    const lastMigratedFrom = o['lastMigratedFrom'];
    return {
      schema: int(o, 'schema', '', 1, Number.MAX_SAFE_INTEGER),
      installedAt: timestamp(o, 'installedAt', ''),
      lastMigratedFrom:
        lastMigratedFrom === null
          ? null
          : int(o, 'lastMigratedFrom', '', 1, Number.MAX_SAFE_INTEGER),
    };
  });
}

export function validateExportBundle(v: unknown): Result<ExportBundle> {
  return run(() => {
    const o = record(v, '');
    if (o['kind'] !== 'ai-pinpoint-export') {
      throw new Invalid('kind', 'not an AI Pinpoint export file');
    }
    const schema = currentSchema(o, '');
    const threads = list(o, 'threads', '', MAX_THREADS_PER_HOST * HOST_IDS.length).map((t, i) =>
      readThreadRecord(t, join('threads', i)),
    );
    for (const hostId of HOST_IDS) {
      const count = threads.filter((t) => t.hostId === hostId).length;
      if (count > MAX_THREADS_PER_HOST) {
        throw new Invalid(
          'threads',
          `too many threads for ${hostId} (max ${MAX_THREADS_PER_HOST})`,
        );
      }
    }
    return {
      kind: 'ai-pinpoint-export',
      schema,
      exportedAt: timestamp(o, 'exportedAt', ''),
      extensionVersion: text(o, 'extensionVersion', '', MAX_VERSION_CHARS),
      settings: readSettings(o['settings'], 'settings'),
      threads,
    };
  });
}
