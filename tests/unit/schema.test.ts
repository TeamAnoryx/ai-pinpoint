import {
  HIGHLIGHT_MS_MAX,
  MAX_ID_CHARS,
  MAX_LABEL_CHARS,
  MAX_PINS_PER_THREAD,
  MAX_SNIPPET_CHARS,
  MAX_THREADS_PER_HOST,
  MIN_SNIPPET_CHARS,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '@shared/constants';
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type ExportBundle,
  type Pin,
  type Result,
  type ThreadRecord,
  validateExportBundle,
  validateHostIndex,
  validatePin,
  validateSettings,
  validateStoreMeta,
  validateThreadRecord,
  validateThreadSummary,
  valueOr,
} from '@shared/schema';

const GARBAGE: unknown[] = [null, undefined, 0, 1, 'str', true, [], [1, 2], () => 1, Symbol('x')];

function pin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pinId: 'lq3k9x-abc123',
    targetHash: 'c:1a2b3c:5',
    nativeId: null,
    role: 'assistant',
    snippet: 'Here is the refactored store module',
    textLength: 1834,
    ordinal: 5,
    label: null,
    order: 100,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    repairCount: 0,
    ...overrides,
  };
}

function thread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SCHEMA_VERSION,
    hostId: 'claude',
    threadId: 'claude:abc-123',
    title: 'Refactor plan',
    pins: [pin()],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function expectOk<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.path}: ${r.error.message}`);
  return r.value;
}

function expectErr<T>(r: Result<T>, path?: string): void {
  expect(r.ok).toBe(false);
  if (!r.ok && path !== undefined) expect(r.error.path).toBe(path);
}

describe('validatePin', () => {
  test('accepts a valid pin unchanged', () => {
    expect(expectOk(validatePin(pin()))).toEqual(pin());
  });

  test('strips unknown keys', () => {
    const value = expectOk(validatePin(pin({ evil: '<script>', __extra: 1 })));
    expect(value).not.toHaveProperty('evil');
    expect(value).not.toHaveProperty('__extra');
  });

  test('clamps snippet and label lengths', () => {
    const value = expectOk(
      validatePin(pin({ snippet: 'x'.repeat(MAX_SNIPPET_CHARS + 50), label: 'y'.repeat(500) })),
    );
    expect(value.snippet).toHaveLength(MAX_SNIPPET_CHARS);
    expect(value.label).toHaveLength(MAX_LABEL_CHARS);
  });

  test('does not split a surrogate pair when clamping', () => {
    const label = `${'a'.repeat(MAX_LABEL_CHARS - 1)}😀`;
    const value = expectOk(validatePin(pin({ label })));
    expect(value.label).toBe('a'.repeat(MAX_LABEL_CHARS - 1));
  });

  test('clamps negative counters to zero and truncates fractions', () => {
    const value = expectOk(validatePin(pin({ ordinal: -4, repairCount: -1, textLength: 12.7 })));
    expect(value.ordinal).toBe(0);
    expect(value.repairCount).toBe(0);
    expect(value.textLength).toBe(12);
  });

  test('rejects wrong types with a field path', () => {
    expectErr(validatePin(pin({ role: 'system' })), 'role');
    expectErr(validatePin(pin({ order: Number.NaN })), 'order');
    expectErr(validatePin(pin({ createdAt: '2024' })), 'createdAt');
    expectErr(validatePin(pin({ label: 42 })), 'label');
  });

  test('rejects empty or over-long identifiers instead of truncating them', () => {
    expectErr(validatePin(pin({ pinId: '' })), 'pinId');
    expectErr(validatePin(pin({ targetHash: 'h'.repeat(MAX_ID_CHARS + 1) })), 'targetHash');
    expectErr(validatePin(pin({ nativeId: '' })), 'nativeId');
    expect(expectOk(validatePin(pin({ nativeId: 'msg-uuid' }))).nativeId).toBe('msg-uuid');
  });

  test('never throws on garbage input', () => {
    for (const g of GARBAGE) expect(validatePin(g).ok).toBe(false);
  });

  test('never throws when a getter throws', () => {
    const hostile = Object.defineProperty({}, 'pinId', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    expect(validatePin(hostile).ok).toBe(false);
  });
});

describe('validateThreadRecord', () => {
  test('accepts a valid record', () => {
    expect(expectOk(validateThreadRecord(thread()))).toEqual(thread());
  });

  test('reports the path of an invalid nested pin', () => {
    expectErr(validateThreadRecord(thread({ pins: [pin(), pin({ role: 1 })] })), 'pins[1].role');
  });

  test('rejects more than MAX_PINS_PER_THREAD pins', () => {
    const pins = Array.from({ length: MAX_PINS_PER_THREAD + 1 }, (_, i) => pin({ pinId: `p${i}` }));
    expectErr(validateThreadRecord(thread({ pins })), 'pins');
  });

  test('accepts exactly MAX_PINS_PER_THREAD pins', () => {
    const pins = Array.from({ length: MAX_PINS_PER_THREAD }, (_, i) => pin({ pinId: `p${i}` }));
    expect(validateThreadRecord(thread({ pins })).ok).toBe(true);
  });

  test('rejects a newer schema with a specific message', () => {
    const r = validateThreadRecord(thread({ schema: SCHEMA_VERSION + 1 }));
    expectErr(r, 'schema');
    if (!r.ok) expect(r.error.message).toMatch(/newer/);
  });

  test('rejects unknown host ids', () => {
    expectErr(validateThreadRecord(thread({ hostId: 'bard' })), 'hostId');
  });

  test('never throws on garbage input', () => {
    for (const g of GARBAGE) expect(validateThreadRecord(g).ok).toBe(false);
  });
});

describe('validateThreadSummary / validateHostIndex', () => {
  const summary = {
    threadId: 'claude:abc',
    title: null,
    pinCount: 3,
    updatedAt: 1,
    url: 'https://example.test/chat/abc',
  };

  test('accepts https URLs and rejects every other scheme', () => {
    expect(validateThreadSummary(summary).ok).toBe(true);
    for (const url of ['javascript:alert(1)', 'http://x.test/', 'data:text/html,x', '']) {
      expectErr(validateThreadSummary({ ...summary, url }), 'url');
    }
  });

  test('host index rejects more than MAX_THREADS_PER_HOST entries', () => {
    const threads = Array.from({ length: MAX_THREADS_PER_HOST + 1 }, () => summary);
    expectErr(validateHostIndex({ schema: SCHEMA_VERSION, hostId: 'claude', threads }), 'threads');
  });

  test('host index reports nested summary paths', () => {
    const r = validateHostIndex({
      schema: SCHEMA_VERSION,
      hostId: 'gemini',
      threads: [summary, { ...summary, pinCount: 'x' }],
    });
    expectErr(r, 'threads[1].pinCount');
  });
});

describe('validateSettings', () => {
  test('accepts the defaults', () => {
    expect(expectOk(validateSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });

  test('fills missing fields from defaults', () => {
    const value = expectOk(validateSettings({ schema: SCHEMA_VERSION, theme: 'dark' }));
    expect(value).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
  });

  test('fills a missing host entry from defaults', () => {
    const value = expectOk(
      validateSettings({ ...DEFAULT_SETTINGS, hosts: { gemini: { enabled: false } } }),
    );
    expect(value.hosts.gemini.enabled).toBe(false);
    expect(value.hosts.claude.enabled).toBe(true);
  });

  test('clamps numeric ranges', () => {
    const low = expectOk(
      validateSettings({ ...DEFAULT_SETTINGS, sidebarWidth: 10, snippetChars: 1 }),
    );
    expect(low.sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);
    expect(low.snippetChars).toBe(MIN_SNIPPET_CHARS);
    const high = expectOk(
      validateSettings({ ...DEFAULT_SETTINGS, sidebarWidth: 9999, highlightMs: 99_999 }),
    );
    expect(high.sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
    expect(high.highlightMs).toBe(HIGHLIGHT_MS_MAX);
  });

  test('rejects present-but-wrong-typed fields', () => {
    expectErr(validateSettings({ ...DEFAULT_SETTINGS, theme: 'neon' }), 'theme');
    expectErr(validateSettings({ ...DEFAULT_SETTINGS, startCollapsed: 'yes' }), 'startCollapsed');
    expectErr(
      validateSettings({ ...DEFAULT_SETTINGS, hosts: { claude: { enabled: 1 } } }),
      'hosts.claude.enabled',
    );
  });

  test('does not let a __proto__ key change the prototype', () => {
    const parsed: unknown = JSON.parse('{"schema":1,"__proto__":{"polluted":true}}');
    const value = expectOk(validateSettings(parsed));
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  test('never throws on garbage input', () => {
    for (const g of GARBAGE) expect(validateSettings(g).ok).toBe(false);
  });
});

describe('validateStoreMeta', () => {
  test('accepts a schema newer than the code so downgrade can be detected', () => {
    const value = expectOk(
      validateStoreMeta({ schema: SCHEMA_VERSION + 3, installedAt: 1, lastMigratedFrom: null }),
    );
    expect(value.schema).toBe(SCHEMA_VERSION + 3);
  });

  test('rejects missing or wrong-typed fields', () => {
    expectErr(validateStoreMeta({ schema: 1, installedAt: 'now', lastMigratedFrom: null }));
    expectErr(validateStoreMeta({ schema: 'one', installedAt: 1, lastMigratedFrom: null }));
    expect(validateStoreMeta({ schema: 1, installedAt: 1, lastMigratedFrom: 1 }).ok).toBe(true);
  });
});

describe('validateExportBundle', () => {
  function bundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      kind: 'ai-pinpoint-export',
      schema: SCHEMA_VERSION,
      exportedAt: 1_700_000_000_000,
      extensionVersion: '1.0.0',
      settings: DEFAULT_SETTINGS,
      threads: [thread()],
      ...overrides,
    };
  }

  test('round-trips through JSON field-for-field', () => {
    const original = expectOk(validateExportBundle(bundle()));
    const reparsed = expectOk(validateExportBundle(JSON.parse(JSON.stringify(original))));
    expect(reparsed).toEqual<ExportBundle>(original);
    const firstPin: Pin | undefined = reparsed.threads[0]?.pins[0];
    expect(firstPin).toEqual(pin());
  });

  test('rejects a foreign file', () => {
    expectErr(validateExportBundle(bundle({ kind: 'something-else' })), 'kind');
  });

  test('rejects a bundle from a newer schema', () => {
    expectErr(validateExportBundle(bundle({ schema: SCHEMA_VERSION + 1 })), 'schema');
  });

  test('rejects more than MAX_THREADS_PER_HOST threads for one host', () => {
    const threads: ThreadRecord[] = [];
    for (let i = 0; i <= MAX_THREADS_PER_HOST; i++) {
      threads.push(expectOk(validateThreadRecord(thread({ threadId: `claude:${i}` }))));
    }
    expectErr(validateExportBundle(bundle({ threads })), 'threads');
  });

  test('reports nested paths inside threads and settings', () => {
    expectErr(
      validateExportBundle(bundle({ threads: [thread({ pins: [pin({ role: 'x' })] })] })),
      'threads[0].pins[0].role',
    );
    expectErr(
      validateExportBundle(bundle({ settings: { ...DEFAULT_SETTINGS, theme: 1 } })),
      'settings.theme',
    );
  });

  test('never throws on garbage input', () => {
    for (const g of GARBAGE) expect(validateExportBundle(g).ok).toBe(false);
  });
});

describe('valueOr', () => {
  test('returns the value or the fallback', () => {
    expect(valueOr(validatePin(pin()), null)).toEqual(pin());
    expect(valueOr(validatePin(null), null)).toBeNull();
  });
});
