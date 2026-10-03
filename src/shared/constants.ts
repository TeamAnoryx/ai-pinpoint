/**
 * Every timeout, limit, and threshold in the codebase lives here (CLAUDE.md R8).
 * Values from DATA_MODEL.md §11; additions recorded in docs/DECISIONS.md (D-003).
 */

// Limits — DATA_MODEL.md §11
export const MAX_PINS_PER_THREAD = 500;
export const MAX_THREADS_PER_HOST = 2000;
export const MAX_LABEL_CHARS = 120;
/** The label character counter appears past this length (UI_SPEC.md §8). */
export const LABEL_COUNTER_FROM = 100;
export const MAX_SNIPPET_CHARS = 400; // settings-capped, default 140
export const DEFAULT_SNIPPET_CHARS = 140;
export const RECOVERY_BUDGET_MS = 8000;
export const SCROLL_SETTLE_MS = 1500;
export const HIGHLIGHT_MS = 1200;
export const MUTATION_DEBOUNCE_MS = 120;
export const RECONCILE_FRAME_MS = 16;
export const STREAM_SAMPLE_MS = 250;
export const STREAM_TIMEOUT_MS = 6000; // offline-safe: assume finished
export const THREAD_SETTLE_MS = 300;
export const QUOTA_WARN_RATIO = 0.8;
export const QUOTA_BLOCK_RATIO = 0.95;
export const SIMILARITY_THRESHOLD = 0.92;
export const MAX_SIMILARITY_SCAN = 200;

// Settings ranges — UI_SPEC.md §2, §12 (D-003)
export const SIDEBAR_WIDTH_DEFAULT = 320;
export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_MAX = 520;
export const MIN_SNIPPET_CHARS = 60;
export const HIGHLIGHT_MS_MIN = 600;
export const HIGHLIGHT_MS_MAX = 3000;

// Field bounds for validators (D-003)
export const MAX_ID_CHARS = 256;
export const MAX_TITLE_CHARS = 300;
export const MAX_URL_CHARS = 2048;
export const MAX_VERSION_CHARS = 32;

// Store behaviour — DATA_MODEL.md §5, §8, §10; EDGE_CASES.md §9 (D-009)
export const ORDER_STEP = 100;
export const IMPORT_BATCH_SIZE = 20;
export const RPC_TIMEOUT_MS = 5000;
export const RPC_MAX_RETRIES = 1;
/** chrome.storage.local.QUOTA_BYTES without unlimitedStorage; used if the API omits it. */
export const STORAGE_QUOTA_BYTES_FALLBACK = 10_485_760;

// Adapter DOM heuristics — ADAPTERS.md §2, §6; EDGE_CASES.md §11 (D-010)
export const SCROLLABLE_SLACK_PX = 40;
export const DEEP_QUERY_MAX_DEPTH = 6;
export const DEEP_QUERY_NODE_BUDGET = 5000;
export const BUTTON_ROW_MIN_BUTTONS = 2;
/** A button row may carry a tiny label such as a branch counter ("2 / 3"). */
export const BUTTON_ROW_MAX_TEXT_CHARS = 12;
export const GENERIC_MIN_MESSAGE_CHARS = 40;
export const GENERIC_MIN_REPEATS = 3;
/** requestOlderMessages: scroll up by this fraction of the viewport, then wait for growth. */
export const OLDER_MESSAGES_SCROLL_RATIO = 0.9;
export const OLDER_MESSAGES_WAIT_MS = 600;

// Identity, observation, thread watching — DATA_MODEL.md §3–§4; EDGE_CASES.md §4, §6 (D-013)
export const HASH_HEAD_CHARS = 256;
export const HASH_TAIL_CHARS = 128;
export const ORDINAL_BUCKET = 4096;
/** Similarity scan stops at the first candidate at or above this score. */
export const SIMILARITY_EARLY_EXIT = 0.98;
/** Thread size change beyond this ratio since pin time suggests a different edit branch. */
export const BRANCH_DRIFT_RATIO = 0.2;
export const HREF_TICK_MS = 400;
/** A trailing debounce under a constant mutation storm still fires at least this often. */
export const MUTATION_MAX_WAIT_MS = 1000;
export const ADAPTER_FAILURE_LIMIT = 3;
export const ADAPTER_FAILURE_WINDOW_MS = 60_000;
export const OBSERVER_ROOT_TIMEOUT_MS = 15_000;
export const OBSERVER_ROOT_POLL_MS = 250;
/** Fallback continuation delay when requestIdleCallback is unavailable. */
export const IDLE_FALLBACK_MS = 1;

// Injection, highlight, navigation — UI_SPEC.md §5–§6; EDGE_CASES.md §2 (D-014)
export const HIGHLIGHT_FADE_IN_MS = 120;
export const HIGHLIGHT_FADE_OUT_MS = 180;
export const HIGHLIGHT_OUTSET_PX = 4;
/** Manual scroll beyond this distance removes the highlight ring. */
export const HIGHLIGHT_SCROLL_CANCEL_PX = 200;
export const FLOATING_BUTTON_PX = 24;
export const FLOATING_INSET_PX = 4;
export const RECOVERY_STEP_RATIO = 0.8;
export const RECOVERY_STEP_WAIT_MS = 150;
export const RECOVERY_MAX_STEPS = 24;
/** Scroll is settled after this many consecutive frames without a scrollTop change. */
export const SCROLL_SETTLE_FRAMES = 2;
/** A deferred (streaming) node is re-checked this often until it settles. */
export const STREAM_RECHECK_MS = 250;
export const UNDO_MS = 5000;
export const TOAST_MS = 3000;
export const TOAST_ACTION_MS = 5000;
export const FIRST_RUN_TOOLTIP_MS = 12_000;
/** Below this viewport width the sidebar becomes a near-full-width sheet (UI_SPEC.md §1). */
export const NARROW_VIEWPORT_PX = 640;
export const SIDEBAR_MARGIN_PX = 12;
export const CLOCK_TICK_MS = 60_000;

// Storage keys — DATA_MODEL.md §1 (D-003)
export const KEY_PREFIX = 'pp:v1:';
export const SETTINGS_KEY = `${KEY_PREFIX}settings`;
export const META_KEY = `${KEY_PREFIX}meta`;
export const THREAD_KEY_PREFIX = `${KEY_PREFIX}thread:`;
export const INDEX_KEY_PREFIX = `${KEY_PREFIX}index:`;
export const QUARANTINE_KEY_PREFIX = `${KEY_PREFIX}quarantine:`;

export function threadKey(hostId: string, threadId: string): string {
  return `${THREAD_KEY_PREFIX}${hostId}:${threadId}`;
}

export function indexKey(hostId: string): string {
  return `${INDEX_KEY_PREFIX}${hostId}`;
}

export function quarantineKey(key: string): string {
  return `${QUARANTINE_KEY_PREFIX}${key}`;
}
