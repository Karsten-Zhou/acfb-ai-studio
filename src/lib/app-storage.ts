// IndexedDB-backed persistence for the two large client-side keys: the chat
// conversation tree and the image gallery. Both embed base64 image data, so
// they can outgrow localStorage's ~5 MiB per-origin quota long before the
// 25 MiB sync limit is reached. IndexedDB has no such small quota.
//
// `useIDBKeyval` owns the IndexedDB read/write and the cross-tab channel. This
// module adds what it cannot: a snapshot rate limit, folding an existing
// localStorage payload forward, and reporting when a value has been read,
// because a mutation that lands before that read is overwritten by it.

import { toRaw, ref, watch, type Ref } from "vue";
import { get, set } from "idb-keyval";
import { useIDBKeyval } from "@vueuse/integrations/useIDBKeyval";
import { until, useThrottleFn } from "@vueuse/shared";
import { STORAGE_KEY } from "@shared/chat";
import { migrateChatStorage, type KeyValueStore } from "@shared/chat-migration";

/** localStorage key of the image gallery. */
export const GALLERY_STORAGE_KEY = "draw:gallery:v1";

/** Write cadence for a persisted ref, in ms. */
const SNAPSHOT_THROTTLE_MS = 300;

/**
 * Why persistence is degraded, reported to the UI until the page reloads.
 *
 * - `unavailable`: IndexedDB could not be read or written, so this session's
 *   changes would be lost on reload.
 * - `legacy-unreadable`: a legacy `localStorage` copy exists but could not be
 *   parsed; it is left untouched and stays unused.
 */
export type StorageIssue = "unavailable" | "legacy-unreadable";

export const storageIssue = ref<StorageIssue | null>(null);

/**
 * Reactive state backed by IndexedDB, written at most once per `throttleMs`.
 *
 * `useIDBKeyval` has no `eventFilter`, so its own watcher would clone and write
 * the whole tree on every streamed chunk — around 17ms each for a 5 MB history.
 * The tree is therefore mirrored: `state` is what the app mutates, and only the
 * throttled snapshot is cloned, persisted and broadcast.
 *
 * `hydrated` resolves once the stored value has been read into `state`; await
 * it before writing through a value that may have existed before this session.
 */
export function usePersistentState<T>(key: string, initialValue: T) {
  const persisted = useIDBKeyval<T>(key, initialValue, {
    // `data` only ever receives a complete snapshot, so deep tracking would
    // walk the whole tree to notice that its reference changed.
    deep: false,
    onError: (error: unknown) => {
      storageIssue.value = "unavailable";
      console.error(
        `[storage] could not read or write "${key}" in IndexedDB:`,
        error,
      );
    },
  });
  const state = ref(toRaw(initialValue)) as Ref<T>;
  /**
   * The snapshot currently representing `state` on disk. Identity is what tells
   * our own write back out from another tab's, which arrives as a new object.
   */
  let snapshot = state.value;
  let applyingRemote = false;
  /**
   * Local mutations seen, and the count at which the store was last current.
   * A counter rather than an identity check because a nested mutation does not
   * change the tree's reference, while adopting a remote value does.
   */
  let edits = 0;
  let storedAtEdits = 0;

  const takeSnapshot = useThrottleFn(
    () => {
      // A remote update can land while this trailing edge is queued and leave
      // the store exactly current; re-cloning would only echo the same bytes
      // back to IndexedDB and to the other tab.
      if (edits === storedAtEdits) return;
      storedAtEdits = edits;
      // `toRaw` first: the raw graph holds plain objects, while reading through
      // the reactive proxy would clone through a proxy per node.
      snapshot = structuredClone(toRaw(state.value));
      persisted.data.value = snapshot;
    },
    SNAPSHOT_THROTTLE_MS,
    // Keep the trailing edge, so the last streamed chunk is never dropped.
    true,
  );

  // `flush: 'sync'` so a remote update reaching `state` is visible to this
  // guard in the same tick, rather than after the flag has been cleared.
  watch(
    state,
    () => {
      if (applyingRemote) return;
      edits++;
      takeSnapshot();
    },
    { deep: true, flush: "sync" },
  );

  watch(
    persisted.data,
    (incoming) => {
      // Compare the raw targets: reading `persisted.data` yields a reactive
      // proxy of what was assigned, so a plain identity check would never see
      // our own snapshot and would rebind `state` to a clone of it — detaching
      // any node a caller holds a live reference to, like the reply being
      // streamed into.
      if (toRaw(incoming) === toRaw(snapshot)) return;
      snapshot = incoming;
      applyingRemote = true;
      state.value = incoming;
      applyingRemote = false;
      // This tab now holds exactly what the store holds, so anything queued
      // before this update has nothing left to write.
      storedAtEdits = edits;
    },
    { flush: "sync" },
  );

  return { state, hydrated: until(persisted.isFinished).toBe(true) };
}

/**
 * Copy one legacy `localStorage` value into IndexedDB, freeing the old copy
 * only after the write lands so an interrupted migration keeps its source.
 *
 * An existing IndexedDB value wins — except an empty array, which does not
 * count as data: the first read of a fresh store writes that, and treating it
 * as migrated would strand the legacy payload in `localStorage` forever. Same
 * rule as `migrateChatStorage`.
 */
async function migrateKey(key: string, local: KeyValueStore): Promise<void> {
  const stored = await get<unknown>(key);
  const hasData =
    stored !== undefined && !(Array.isArray(stored) && !stored.length);
  if (hasData) return;

  const raw = local.getItem(key);
  if (raw === null) return;

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    // Left in `localStorage` for manual recovery, and reported: the user has to
    // learn that a copy of their data is sitting there unread.
    storageIssue.value ??= "legacy-unreadable";
    console.error(
      `[storage] Legacy "${key}" is not valid JSON and stays in localStorage:`,
      error,
    );
    return;
  }

  await set(key, value);
  local.removeItem(key);
}

/**
 * Move persisted state off localStorage before any store reads IndexedDB: fold
 * legacy chat schema versions forward, then copy the current chat key and the
 * gallery into IndexedDB.
 *
 * Must finish before the stores are created. IndexedDB is the only target — if
 * it is unavailable the app keeps state for the session rather than falling
 * back to the quota this change exists to escape.
 */
export async function initAppStorage(): Promise<void> {
  let local: KeyValueStore | null = null;
  try {
    local = window.localStorage;
    const folded = migrateChatStorage(local);
    if (folded.blocked) {
      storageIssue.value ??= "legacy-unreadable";
      console.error(
        `[storage] Legacy chat data is present but was not folded forward (${folded.blocked}${
          folded.detail ? `: ${folded.detail}` : ""
        }). It stays in localStorage.`,
      );
    }
  } catch (error) {
    console.error("[storage] Legacy chat migration failed:", error);
  }
  if (!local) return;

  for (const key of [STORAGE_KEY, GALLERY_STORAGE_KEY]) {
    try {
      await migrateKey(key, local);
    } catch (error) {
      console.error(`[storage] Failed to migrate "${key}":`, error);
    }
  }
}
