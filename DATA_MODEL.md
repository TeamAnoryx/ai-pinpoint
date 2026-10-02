# DATA MODEL — storage, identity, migrations

All persistence is local (`chrome.storage.local`). No network, no sync in v1.0. See `PRD.md` §6.

---

## 1. Storage keys

Flat key space, one record per thread. **Never** store all pins under a single key — that makes every write rewrite everything and blows the per-item limit.

| Key pattern | Value | Notes |
|---|---|---|
| `pp:v1:settings` | `Settings` | single record |
| `pp:v1:thread:<hostId>:<threadId>` | `ThreadRecord` | one per thread with ≥ 1 pin; deleted when empty |
| `pp:v1:index:<hostId>` | `HostIndex` | lightweight list of thread summaries for FR-7 |
| `pp:v1:meta` | `StoreMeta` | schema version, install time, last migration |

Rules:
- Writing a pin touches exactly two keys: the thread record and the host index.
- `threadId` is already host-prefixed by the adapter (`chatgpt:<uuid>`); the key repeats `hostId` for cheap prefix scans.
- A thread record with zero pins is removed, and its index entry with it.

## 2. Types (`src/shared/schema.ts`)

```ts
export const SCHEMA_VERSION = 1 as const;

export type HostId = 'gemini' | 'chatgpt' | 'claude' | 'generic';
export type Role   = 'user' | 'assistant' | 'unknown';

export interface Pin {
  /** ULID-ish: base36 timestamp + 6 random chars. Sortable, no deps. */
  pinId: string;

  /** Primary identity for re-finding the message. See §4. */
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

  createdAt: number;   // epoch ms
  updatedAt: number;   // epoch ms

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
  sidebarWidth: number;          // px, 240–520
  theme: 'auto' | 'light' | 'dark';
  startCollapsed: boolean;
  highlightMs: number;           // default 1200
  snippetChars: number;          // default 140, max 400
  reducedMotion: 'auto' | 'on' | 'off';
  firstRunDone: boolean;
}

export interface StoreMeta {
  schema: typeof SCHEMA_VERSION;
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
```

### Validation

Hand-write validators (no runtime dep — see `TECH_STACK.md` §4):

```ts
export function validatePin(v: unknown): Result<Pin>
export function validateThreadRecord(v: unknown): Result<ThreadRecord>
export function validateSettings(v: unknown): Result<Settings>
export function validateExportBundle(v: unknown): Result<ExportBundle>
```

Every validator: checks `typeof`, clamps numeric ranges, clamps string lengths, rejects arrays longer than limits (`MAX_PINS_PER_THREAD = 500`, `MAX_THREADS_PER_HOST = 2000`), and strips unknown keys. The service worker runs the validator on **every** inbound RPC payload and on **every** value read from storage (storage can hold data written by an older or corrupted build).

## 3. Thread ID resolution

```ts
function resolveThreadId(adapter, loc): string {
  const id = adapter.getThreadId(loc);
  if (id) return id;                       // e.g. 'chatgpt:7f3a...'
  return `transient:${adapter.id}:${sessionNonce}`;
}
```

- A `transient:` thread is **held in memory only and never written to storage.** When the host assigns a real id (first response in a new chat changes the URL), the engine re-resolves and promotes the in-memory pins to a real thread record in one write.
- Promotion is a single atomic operation; if it fails, the pins stay in memory and the overlay shows "not yet saved — send a message to save pins".
- Never reuse a nonce across page loads.

## 4. Message identity (`identity.ts`) — the critical algorithm

Identity must be stable across: page reload, thread re-open, virtual scroll unmount/remount, and host re-render. It must **not** be stable across different messages with similar text.

### Resolution order when pinning

```
1. nativeId present?          → targetHash = `n:${hash(nativeId)}`          (confidence: high)
2. else                       → targetHash = `c:${contentHash}`             (confidence: medium)
```

### Content hash

```ts
function contentHash(role: Role, text: string, ordinal: number): string {
  const norm = normaliseForHash(text);
  const head = norm.slice(0, 256);
  const tail = norm.slice(-128);
  const base = `${role}|${norm.length}|${head}|${tail}`;
  return fnv1a32(base).toString(36) + ':' + (ordinal % 4096).toString(36);
}
```

- `normaliseForHash`: lowercase, collapse all whitespace to single spaces, strip punctuation runs, strip zero-width and bidi marks, NFC normalise. **Must exclude** host chrome (button labels), artifact cards, and collapsible reasoning blocks (see `ADAPTERS.md` §5).
- `head + tail + length` makes two long messages with the same opening distinguishable.
- `fnv1a32` — 32-bit FNV-1a, ~12 lines, no dependency. Collisions are handled, not prevented.
- The ordinal suffix is a **tiebreaker, not part of matching**: resolution first tries the full hash, then the hash without the ordinal segment. This is what makes a pin survive messages being inserted above it (branch switching, "load earlier").

### Resolution when navigating

```
1. exact targetHash in live index            → hit
2. nativeId match (if pin has one)           → hit, repair targetHash
3. hash-without-ordinal match, unique        → hit, repair targetHash (ordinal drifted)
4. hash-without-ordinal match, ambiguous     → pick candidate with closest ordinal
5. snippet similarity >= 0.92 over live nodes→ hit, repair targetHash, repairCount++
6. run RECOVER (scroll + re-index), retry 1–5
7. budget exhausted                          → NOT_FOUND
```

Similarity: normalised Levenshtein ratio on the first 140 chars, or trigram Jaccard (cheaper — prefer trigram, threshold 0.92). Compare against at most 200 candidate nodes; bail out early on first ≥ 0.98 match.

### Repair semantics

When resolution succeeds via a fallback path, the pin's `targetHash` is rewritten to the currently-computed hash and `repairCount` is incremented via `pins:repairHash`. Repair is best-effort and must never block navigation; fire it after scrolling begins.

### Collision policy

Two different messages can produce the same content hash (identical text, same role, same ordinal bucket — e.g. the user sent "yes" twice). Policy:
- Pinning stores `ordinal` and `textLength`, so navigation can disambiguate by ordinal distance.
- The overlay shows a subtle "duplicate text" marker on such a pin so the user knows the jump may land on the sibling.
- Never dedupe pins by hash alone; dedupe by `pinId`.

## 5. Ordering

`order` uses sparse integers: first pin 100, next 200, etc. Dropping a pin between 100 and 200 sets `order = 150`. When the gap closes (`|a-b| <= 1`), renormalise the whole thread's orders to multiples of 100 in a single write. This avoids rewriting every pin on each drag.

Default sort for display: `order` ascending, ties broken by `createdAt`.

## 6. Write path and concurrency

Single writer = the service worker (`ARCHITECTURE.md` I5). Within the SW:

```ts
async function mutateThread(hostId, threadId, fn: (r: ThreadRecord) => ThreadRecord) {
  return withLock(`${hostId}:${threadId}`, async () => {
    const key = threadKey(hostId, threadId);
    const raw = (await chrome.storage.local.get(key))[key];
    const rec = raw ? validateThreadRecord(raw).valueOr(emptyThread(hostId, threadId))
                    : emptyThread(hostId, threadId);
    const next = fn(rec);
    next.updatedAt = Date.now();
    assertUnderLimits(next);
    if (next.pins.length === 0) {
      await chrome.storage.local.remove(key);
      await removeFromIndex(hostId, threadId);
    } else {
      await chrome.storage.local.set({ [key]: next });
      await upsertIndex(hostId, next);
    }
    broadcast({ type: 'store:changed', payload: { hostId, threadId } });
    return next;
  });
}
```

- `withLock` is an in-memory promise-chain map keyed by thread. MV3 workers can be killed mid-task, so each mutation must be a single `storage.set` — never a read-modify-write split across two awaits that can be interrupted between them (the lock plus one set achieves this).
- The index update is a second write; if it fails, the thread record is still correct and the index is rebuilt lazily by `rebuildIndex(hostId)` (prefix-scan all thread keys). Index is a cache, never a source of truth.
- Multiple tabs on the same thread stay consistent via the `store:changed` broadcast.

## 7. Why not `chrome.storage.sync` in v1.0

`storage.sync` limits: 102,400 bytes total, 8,192 bytes per item, 512 items, 1,800 writes/hour. A single 140-char snippet pin is ~260 bytes of JSON; 500 pins ≈ 130 KB — over quota. Reordering a 40-pin thread would also burn write quota fast.

Deferred design (v1.1, documented now so the schema does not need changing): split each thread record into chunks of ≤ 6 KB keyed `pp:v1:sync:<hostId>:<threadId>:<n>`, sync only `label`, `targetHash`, `nativeId`, `role`, `order`, `createdAt` (drop `snippet` to a 48-char stub), and keep full snippets local. The v1 schema already separates these concerns.

## 8. Quota management

`chrome.storage.local` is effectively ~10 MB without `unlimitedStorage` (which we do not request — NFR-8).

Monitor:
```ts
const { bytesUsed, quota } = await storageStats();   // getBytesInUse(null)
if (bytesUsed / quota > 0.8)  warnOnce('storage-80');
if (bytesUsed / quota > 0.95) blockNewPinsWithExportPrompt();
```

Mitigations, in order:
1. Truncate snippets to `settings.snippetChars` (default 140) at write time — never store full messages.
2. Warn at 80%: banner offering export + prune.
3. Prune flow: list threads by `updatedAt` ascending, let the user delete whole threads; show reclaimed bytes.
4. At 95%: new pins are refused with `QUOTA_EXCEEDED` and a clear message. **Never silently drop.**
5. `assertUnderLimits` enforces `MAX_PINS_PER_THREAD` and `MAX_THREADS_PER_HOST` and returns a typed error the UI explains.

## 9. Migrations

```ts
const MIGRATIONS: Record<number, (db: RawDb) => Promise<RawDb>> = {
  // 1: initial — no migration
};

async function migrate() {
  const meta = await readMeta();                 // absent → fresh install
  if (!meta) { await writeMeta({ schema: SCHEMA_VERSION, installedAt: Date.now(), lastMigratedFrom: null }); return; }
  if (meta.schema === SCHEMA_VERSION) return;
  if (meta.schema > SCHEMA_VERSION) { enterReadOnlyMode('newer-schema'); return; }
  await backupToExportBlobInMemory();            // offer download before touching data
  for (let v = meta.schema; v < SCHEMA_VERSION; v++) await MIGRATIONS[v + 1](db);
  await writeMeta({ ...meta, schema: SCHEMA_VERSION, lastMigratedFrom: meta.schema });
}
```

Rules for future agents:
- Migrations run in the service worker on `chrome.runtime.onInstalled` (`reason === 'update'`) **and** defensively on first RPC after boot (a worker can start before `onInstalled` handling completes).
- Migrations are forward-only and idempotent.
- Never delete data in a migration; rename/transform and keep an `_legacy` field for one version if lossy.
- Downgrade (meta.schema newer than code) → read-only mode with a banner, never a wipe.
- Key prefix includes `v1`; a breaking v2 writes to `pp:v2:*` and leaves v1 keys untouched until the migration is confirmed complete.

## 10. Export / import

**Export** (FR-10): build `ExportBundle` from all `pp:v1:thread:*` keys + settings, `JSON.stringify(bundle, null, 2)`, download via `Blob` + object URL. Filename: `ai-pinpoint-export-YYYY-MM-DD.json`. No network.

**Import**:
1. Read file via `<input type="file">` + `FileReader`.
2. `validateExportBundle` — reject on `kind` mismatch, unknown `schema > SCHEMA_VERSION`, or structural failure, with a specific message.
3. Run migration forward if `schema < SCHEMA_VERSION`.
4. **Dry run** — report: threads to add, threads to merge, pins to add, pins that conflict, total bytes delta, quota outcome.
5. User chooses `merge` (default) or `replace`.
   - `merge`: union by `pinId`; on `pinId` collision keep the record with the newer `updatedAt`; append unknown pins and renormalise `order`.
   - `replace`: delete all existing thread keys for hosts present in the bundle, then write.
6. Write in batches of 20 keys, reporting progress; abort cleanly on quota error with a partial-import report.

Round-trip guarantee (PRD §9.6): export → wipe → import must reproduce identical `Pin` records field-for-field.

## 11. Limits (`src/shared/constants.ts`)

```ts
export const MAX_PINS_PER_THREAD   = 500;
export const MAX_THREADS_PER_HOST  = 2000;
export const MAX_LABEL_CHARS       = 120;
export const MAX_SNIPPET_CHARS     = 400;   // settings-capped, default 140
export const DEFAULT_SNIPPET_CHARS = 140;
export const RECOVERY_BUDGET_MS    = 8000;
export const SCROLL_SETTLE_MS      = 1500;
export const HIGHLIGHT_MS          = 1200;
export const MUTATION_DEBOUNCE_MS  = 120;
export const RECONCILE_FRAME_MS    = 16;
export const STREAM_SAMPLE_MS      = 250;
export const STREAM_TIMEOUT_MS     = 6000;  // offline-safe: assume finished
export const THREAD_SETTLE_MS      = 300;
export const QUOTA_WARN_RATIO      = 0.80;
export const QUOTA_BLOCK_RATIO     = 0.95;
export const SIMILARITY_THRESHOLD  = 0.92;
export const MAX_SIMILARITY_SCAN   = 200;
```

No magic numbers anywhere else in the codebase.
