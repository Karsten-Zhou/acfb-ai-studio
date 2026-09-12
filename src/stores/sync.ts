// Local (per-device) sync bookkeeping, shared by every other store and by the
// sync engine.
//
// The store deliberately imports nothing from `stores/chat.ts` or
// `stores/draw.ts`: those stores need to report deletions and local changes,
// and importing the engine back would create an import cycle. The engine
// registers itself here instead (see `setPayloadCollector` / `setPushScheduler`).
//
// The HTTP/query side of syncing is *not* here — it is an effect that lives in
// `composables/sync.ts`; this store only owns the state the UI reads.

import { computed, ref } from "vue";
import { defineStore } from "pinia";
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

export type SyncPhase = "idle" | "syncing" | "synced" | "error";

export interface SyncError {
  /** Message to show the user. */
  message: string;
  /** True when the stored payload is unreadable and needs an explicit reset. */
  corrupt?: boolean;
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

export const useSyncStore = defineStore("sync", () => {
  /**
   * Persisted so an offline edit survives a reload: `dirty`/`baseRevision` must
   * outlive the tab, otherwise unsynced work would never be uploaded.
   */
  const localMeta = useStorage<LocalSyncMeta>(
    LOCAL_KEY,
    fallbackMeta(),
    undefined,
    { mergeDefaults: true },
  );

  // Reactive status for the UI.
  const phase = ref<SyncPhase>("idle");
  const error = ref<SyncError | null>(null);
  /** Size of the synced payload in bytes (last known). */
  const bytes = ref(0);
  const lastSyncedAt = ref<number | null>(null);

  /**
   * How full the single KV entry is. Past the soft limit new image generations
   * are refused so the user prunes history instead of breaking sync entirely.
   */
  const storageUsage = computed(() => ({
    bytes: bytes.value,
    softLimit: SYNC_SOFT_LIMIT_BYTES,
    max: SYNC_MAX_BYTES,
    ratio: bytes.value / SYNC_MAX_BYTES,
    blocked: bytes.value >= SYNC_SOFT_LIMIT_BYTES,
  }));

  // -------------------------------------------------------------------------
  // Engine hooks (registered by `composables/sync.ts`)
  // -------------------------------------------------------------------------

  let pushScheduler: (() => void) | null = null;
  let collector: (() => unknown) | null = null;

  /** Called by the engine to receive "local state changed" notifications. */
  function setPushScheduler(fn: (() => void) | null): void {
    pushScheduler = fn;
  }

  /** Called by the engine so byte accounting can serialize the live state. */
  function setPayloadCollector(fn: (() => unknown) | null): void {
    collector = fn;
  }

  // -------------------------------------------------------------------------
  // Change tracking
  // -------------------------------------------------------------------------

  let storeStamp = 0;
  let bytesCache: { stamp: number; bytes: number } | null = null;

  /** Bump on every local mutation so cached sizes are recomputed. */
  function bumpStoreStamp(): void {
    storeStamp += 1;
    bytesCache = null;
  }

  /** Serialize the current state to learn its exact stored size. */
  function measure(): number {
    if (bytesCache?.stamp === storeStamp) return bytesCache.bytes;
    const size = collector
      ? new TextEncoder().encode(JSON.stringify(collector())).length
      : 0;
    bytesCache = { stamp: storeStamp, bytes: size };
    return size;
  }

  /**
   * Recompute and publish the current payload size.
   *
   * Only called at points where accuracy matters (before a write, before a
   * generation) — never reactively, because serializing several megabytes on
   * every keystroke would be wasteful.
   */
  function refreshBytes(): number {
    bytes.value = measure();
    return bytes.value;
  }

  /** Flag that local state has changes the server has not seen yet. */
  function markDirty(): void {
    bumpStoreStamp();
    localMeta.value.dirty = true;
    pushScheduler?.();
  }

  /** Record a tombstone so a delete is not resurrected by another device. */
  function recordDeletion(id: string): void {
    // Assign a fresh object: a direct assignment is guaranteed to be persisted
    // by `useStorage`, without relying on deep-watch behaviour.
    localMeta.value.deletions = {
      ...localMeta.value.deletions,
      [id]: Date.now(),
    };
    markDirty();
  }

  return {
    localMeta,
    phase,
    error,
    bytes,
    lastSyncedAt,
    storageUsage,
    setPushScheduler,
    setPayloadCollector,
    bumpStoreStamp,
    refreshBytes,
    markDirty,
    recordDeletion,
  };
});
