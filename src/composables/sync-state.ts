// Local (per-device) sync bookkeeping, shared by the stores and the engine.
//
// This module deliberately imports nothing from `composables/chat.ts` or
// `composables/draw.ts`: those stores need to report deletions and local
// changes, and importing the engine back would create an import cycle. The
// engine registers itself here instead (see `setPayloadCollector` /
// `setPushScheduler`).

import { computed, reactive } from "vue";
import { useStorage } from "@vueuse/core";
import { SYNC_MAX_BYTES, SYNC_SOFT_LIMIT_BYTES } from "@shared/sync";

const LOCAL_KEY = "sync:local:v1";

export const SYNC_META_QUERY_KEY = ["sync", "meta"] as const;
export const SYNC_STATE_QUERY_KEY = ["sync", "state"] as const;

export interface LocalSyncMeta {
  /** Revision of the value this device last read or wrote. */
  baseRevision: number;
  /** True when local changes have not been pushed yet. */
  dirty: boolean;
  /** Tombstones: item id -> deletion time. Mirrored into the server payload. */
  deletions: Record<string, number>;
  /** When the synced defaults were last changed *on this device*. */
  defaultsUpdatedAt: number;
  /** When this device last completed a sync. */
  lastSyncedAt: number | null;
}

function fallbackMeta(): LocalSyncMeta {
  return {
    baseRevision: 0,
    dirty: false,
    deletions: {},
    defaultsUpdatedAt: 0,
    lastSyncedAt: null,
  };
}

/**
 * Persisted so an offline edit survives a reload: `dirty`/`baseRevision` must
 * outlive the tab, otherwise unsynced work would never be uploaded.
 */
export const localMeta = useStorage<LocalSyncMeta>(
  LOCAL_KEY,
  fallbackMeta(),
  undefined,
  { mergeDefaults: true },
);

// ---------------------------------------------------------------------------
// Reactive status for the UI
// ---------------------------------------------------------------------------

export type SyncPhase = "idle" | "syncing" | "synced" | "error";

export interface SyncError {
  /** Message to show the user. */
  message: string;
  /** True when the stored payload is unreadable and needs an explicit reset. */
  corrupt?: boolean;
}

export const syncState = reactive({
  phase: "idle" as SyncPhase,
  error: null as SyncError | null,
  /** Size of the synced payload in bytes (last known). */
  bytes: 0,
  lastSyncedAt: null as number | null,
});

/**
 * How full the single KV entry is. Past the soft limit new image generations
 * are refused so the user prunes history instead of breaking sync entirely.
 */
export const storageUsage = computed(() => ({
  bytes: syncState.bytes,
  softLimit: SYNC_SOFT_LIMIT_BYTES,
  max: SYNC_MAX_BYTES,
  ratio: syncState.bytes / SYNC_MAX_BYTES,
  blocked: syncState.bytes >= SYNC_SOFT_LIMIT_BYTES,
}));

// ---------------------------------------------------------------------------
// Engine hooks (registered by `composables/sync.ts`)
// ---------------------------------------------------------------------------

function noop(): void {}

let pushScheduler: () => void = noop;

/** Called by the engine to receive "local state changed" notifications. */
export function setPushScheduler(fn: (() => void) | null): void {
  pushScheduler = fn ?? noop;
}

let collector: (() => unknown) | null = null;

/** Called by the engine so byte accounting can serialize the live state. */
export function setPayloadCollector(fn: (() => unknown) | null): void {
  collector = fn;
}

// ---------------------------------------------------------------------------
// Change tracking
// ---------------------------------------------------------------------------

let storeStamp = 0;
let bytesCache: { stamp: number; bytes: number } | null = null;

/** Bump on every local mutation so cached sizes are recomputed. */
export function bumpStoreStamp(): void {
  storeStamp += 1;
  bytesCache = null;
}

/** Serialize the current state to learn its exact stored size. */
function measure(): number {
  if (bytesCache?.stamp === storeStamp) return bytesCache.bytes;
  const bytes = collector
    ? new TextEncoder().encode(JSON.stringify(collector())).length
    : 0;
  bytesCache = { stamp: storeStamp, bytes };
  return bytes;
}

/**
 * Recompute and publish the current payload size.
 *
 * Only called at points where accuracy matters (before a write, before a
 * generation) — never reactively, because serializing several megabytes on
 * every keystroke would be wasteful.
 */
export function refreshBytes(): number {
  syncState.bytes = measure();
  return syncState.bytes;
}

/** Record a tombstone so a delete is not resurrected by another device. */
export function recordDeletion(id: string): void {
  // Assign a fresh object: a direct assignment is guaranteed to be persisted by
  // `useStorage`, without relying on deep-watch behaviour.
  localMeta.value.deletions = {
    ...localMeta.value.deletions,
    [id]: Date.now(),
  };
  markDirty();
}

/** Flag that local state has changes the server has not seen yet. */
export function markDirty(): void {
  bumpStoreStamp();
  localMeta.value.dirty = true;
  pushScheduler();
}
