// Cross-device sync engine.
//
// Pull is driven by a cheap metadata poll (`GET /api/sync/meta` reads KV
// metadata only), so we learn about changes from other devices without
// downloading a multi-megabyte payload. The full state is fetched only once the
// revision actually moved.
//
// Writes use compare-and-swap: we send the revision we last saw and the server
// rejects a stale write with 409 plus the current state, which we merge and
// retry — so a device that has been offline cannot silently clobber newer work.

import { nextTick, onScopeDispose, watch } from "vue";
import { useDebounceFn, useIntervalFn } from "@vueuse/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  SYNC_MAX_BYTES,
  SYNC_VERSION,
  describePayloadIssues,
  encodeSyncPush,
  mergePayloads,
  type SyncConflictResponse,
  type SyncMeta,
  type SyncPayload,
  type SyncStateResponse,
} from "@shared/sync";
import { CORRUPT_STATE } from "@shared/errors";
import { readApiError } from "@/lib/api-error";
import { chatStore } from "./chat";
import { drawStore } from "./draw";
import { defaultOptions } from "./settings";
import {
  SYNC_META_QUERY_KEY,
  SYNC_STATE_QUERY_KEY,
  bumpStoreStamp,
  localMeta,
  markDirty,
  setPayloadCollector,
  setPushScheduler,
  syncState,
  type SyncError,
} from "./sync-state";

/** How often we ask whether another device wrote something. */
const META_POLL_MS = 10_000;
/** Upper bound on how long a local change may sit unsynced. */
const MAX_LATENCY_MS = 5_000;
/** Quiet period after the last local change before we upload. */
const PUSH_DEBOUNCE_MS = 1_200;
/** Compare-and-swap retries before giving up for this round. */
const MAX_PUSH_ATTEMPTS = 3;

/** Set while the engine is mounted; lets UI actions trigger an immediate sync. */
let syncNow: (() => Promise<void>) | null = null;

/** Trigger a sync round now (no-op before the engine mounts). */
export function requestSync(): void {
  void syncNow?.();
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The request never reached the server (offline, DNS) or the server refused it. */
class SyncRequestError extends Error {
  /** True when the stored payload is unreadable and needs a reset. */
  corrupt: boolean;

  constructor(message: string, corrupt = false) {
    super(message);
    this.name = "SyncRequestError";
    this.corrupt = corrupt;
  }
}

/** Our compare-and-swap lost; the server returned the winning state. */
class SyncConflictError extends Error {
  conflict: SyncConflictResponse;
  constructor(conflict: SyncConflictResponse) {
    super("Sync conflict");
    this.name = "SyncConflictError";
    this.conflict = conflict;
  }
}

function toSyncError(err: unknown): SyncError {
  if (err instanceof SyncRequestError) {
    return err.corrupt
      ? { message: err.message, corrupt: true }
      : { message: err.message };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}
// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface StateEnvelope {
  payload: SyncPayload | null;
  revision: number;
  bytes: number;
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Turn a failed response into a sync error, carrying the server's reason. */
async function httpError(res: Response): Promise<SyncRequestError> {
  const { message, code } = await readApiError(res);
  return new SyncRequestError(message, code === CORRUPT_STATE);
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new SyncRequestError(
      "Can't reach the sync server. Changes are saved on this device and will sync when the connection returns.",
    );
  }
}

async function fetchMeta(): Promise<SyncMeta> {
  const res = await request("/api/sync/meta", {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw await httpError(res);
  const body = await readJson<SyncMeta>(res);
  if (!body) {
    throw new SyncRequestError("Sync metadata could not be parsed.");
  }
  return body;
}

async function fetchState(): Promise<SyncStateResponse> {
  const res = await request("/api/sync", {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw await httpError(res);
  const body = await readJson<StateEnvelope>(res);
  if (!body) {
    throw new SyncRequestError("Sync state could not be parsed.");
  }
  if (!body.payload) throw new SyncRequestError("Sync state is empty.");
  return { payload: body.payload, revision: body.revision, bytes: body.bytes };
}

async function putState(body: string): Promise<SyncStateResponse> {
  const res = await request("/api/sync", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });

  if (res.status === 409) {
    const conflict = await readJson<SyncConflictResponse>(res);
    if (!conflict) {
      throw new SyncRequestError("Sync conflict could not be parsed.");
    }
    throw new SyncConflictError(conflict);
  }
  if (!res.ok) throw await httpError(res);

  const result = await readJson<SyncStateResponse>(res);
  if (!result) {
    throw new SyncRequestError("Sync response could not be parsed.");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Payload plumbing
// ---------------------------------------------------------------------------

/** Guards against re-entrant writes while we are adopting remote state. */
let applying = false;

function collectPayload(): SyncPayload {
  return {
    version: SYNC_VERSION,
    revision: localMeta.value.baseRevision,
    updatedAt: Date.now(),
    conversations: chatStore.conversations,
    gallery: drawStore.gallery,
    defaults: defaultOptions,
    defaultsUpdatedAt: localMeta.value.defaultsUpdatedAt,
    deletions: localMeta.value.deletions,
  };
}

function emptyPayload(): SyncPayload {
  return {
    version: SYNC_VERSION,
    revision: 0,
    updatedAt: 0,
    conversations: [],
    gallery: [],
    defaults: defaultOptions,
    defaultsUpdatedAt: 0,
    deletions: {},
  };
}

function hasLocalContent(): boolean {
  return chatStore.conversations.length > 0 || drawStore.gallery.length > 0;
}

/**
 * True while a chat turn or image generation is in flight.
 *
 * The stores hold partial state then, so adopting remote state would both
 * upload a half-written message and — worse — swap out the very objects the
 * in-flight generator is appending to, so the user would see nothing while the
 * stream appeared to work.
 */
function isBusy(): boolean {
  return chatStore.streaming || drawStore.generating;
}

/**
 * Adopt a merged payload into the stores.
 *
 * Every write is funnelled through here so the change watchers can be muted for
 * the duration: otherwise applying remote state would mark the stores dirty and
 * we would immediately push back what we just received.
 *
 * Returns `false`, without touching anything, if a turn started while we were
 * fetching. Callers must then leave their bookkeeping dirty so the next round
 * retries. The check-and-write below is synchronous, so nothing can interleave.
 */
async function applyPayload(payload: SyncPayload): Promise<boolean> {
  if (isBusy()) return false;

  applying = true;
  try {
    chatStore.conversations = payload.conversations;
    // Only clear a selection that no longer exists; never move the user to a
    // different thread on their behalf.
    if (!payload.conversations.some((c) => c.id === chatStore.activeId)) {
      chatStore.activeId = null;
    }
    drawStore.gallery = payload.gallery;
    Object.assign(defaultOptions, payload.defaults);
    localMeta.value.deletions = { ...payload.deletions };
    localMeta.value.defaultsUpdatedAt = payload.defaultsUpdatedAt;
  } finally {
    await nextTick();
    applying = false;
    // The stores changed behind the watchers' backs, so invalidate the size cache.
    bumpStoreStamp();
  }
  return true;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function tooLargeError(bytes: number): SyncRequestError {
  return new SyncRequestError(
    `History is ${formatMb(bytes)}, over the ${formatMb(SYNC_MAX_BYTES)} limit for a single synced entry. Delete some conversations or images to resume syncing.`,
  );
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Mount the sync engine. Call once from the root component's setup; it lives
 * for the lifetime of the app.
 */
export function useSyncEngine(): void {
  const queryClient = useQueryClient();

  let running = false;

  const metaQuery = useQuery({
    queryKey: SYNC_META_QUERY_KEY,
    queryFn: fetchMeta,
    refetchInterval: META_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const pushMutation = useMutation({
    mutationFn: (body: string) => putState(body),
  });

  const debouncedSync = useDebounceFn(() => void reconcile(), PUSH_DEBOUNCE_MS);

  function settle(): void {
    syncState.phase = "synced";
    syncState.error = null;
    syncState.lastSyncedAt = Date.now();
    localMeta.value.lastSyncedAt = syncState.lastSyncedAt;
  }

  function fail(err: unknown): void {
    syncState.phase = "error";
    syncState.error = toSyncError(err);
  }

  /**
   * Upload the local state, resolving compare-and-swap conflicts by merging the
   * winner's state in and retrying.
   */
  async function push(baseRevision: number, initial: SyncPayload): Promise<void> {
    let base = baseRevision;
    let payload = initial;

    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
      // Validate here rather than letting the server reject it: a 400 from the
      // server only says "invalid", while this names the offending field.
      const issues = describePayloadIssues(payload);
      if (issues) {
        console.error(
          "[sync] refusing to upload an invalid payload:",
          issues,
          payload,
        );
        throw new SyncRequestError(
          `Local state can't be synced (${issues}).`,
        );
      }

      // The wire format is the compare-and-swap envelope; only `payload` is
      // stored. Sending the bare payload makes the server reject every write.
      const body = encodeSyncPush({ baseRevision: base, payload });
      const bytes = new TextEncoder().encode(body).length;
      if (bytes > SYNC_MAX_BYTES) throw tooLargeError(bytes);

      try {
        const result = await pushMutation.mutateAsync(body);
        localMeta.value.baseRevision = result.revision;
        localMeta.value.dirty = false;
        syncState.bytes = result.bytes;
        queryClient.setQueryData(SYNC_STATE_QUERY_KEY, result);
        return;
      } catch (err) {
        if (!(err instanceof SyncConflictError)) throw err;

        // Another device got there first. Adopt its revision, merge, and retry
        // so neither side's work is dropped.
        const conflict = err.conflict;
        const merged = mergePayloads(payload, conflict.payload ?? emptyPayload());

        if (merged.changedLocal && !(await applyPayload(merged.payload))) {
          // A turn started while the conflict was being resolved. Leave the
          // bookkeeping dirty so the next round retries from scratch.
          return;
        }

        // Only adopt the winner's revision once our state reflects the merge.
        base = conflict.revision;
        localMeta.value.baseRevision = base;

        if (!merged.changedRemote) {
          // Converged: the server already holds exactly this state.
          localMeta.value.dirty = false;
          syncState.bytes = conflict.bytes;
          return;
        }
        payload = merged.payload;
      }
    }

    throw new Error(
      "Sync kept conflicting after several attempts. Try again in a moment.",
    );
  }

  /**
   * One pull/merge/push round, used when this device has nothing outstanding:
   * we only need to find out whether another device wrote something.
   */
  async function pull(meta: SyncMeta): Promise<void> {
    if (meta.empty) {
      syncState.bytes = 0;
      localMeta.value.baseRevision = 0;
      if (hasLocalContent()) {
        // Storage was cleared behind our back; republish what we hold.
        await push(0, collectPayload());
      } else {
        localMeta.value.dirty = false;
      }
      return;
    }

    if (meta.revision === localMeta.value.baseRevision) {
      syncState.bytes = meta.bytes;
      return;
    }

    // The server moved on: download, merge, then publish whatever we still hold.
    const remote = await fetchStateOnce();
    const merged = mergePayloads(collectPayload(), remote.payload);

    if (merged.changedLocal && !(await applyPayload(merged.payload))) {
      // A turn started while we were downloading. Leave `baseRevision` untouched
      // so the next round re-detects the change instead of assuming we applied it.
      return;
    }

    localMeta.value.baseRevision = remote.revision;

    if (merged.changedLocal) await applyPayload(merged.payload);

    if (merged.changedRemote) {
      await push(remote.revision, merged.payload);
    } else {
      localMeta.value.dirty = false;
      syncState.bytes = remote.bytes;
    }
  }

  function fetchMetaOnce(): Promise<SyncMeta> {
    return queryClient.fetchQuery({
      queryKey: SYNC_META_QUERY_KEY,
      queryFn: fetchMeta,
      staleTime: 0,
    });
  }

  function fetchStateOnce(): Promise<SyncStateResponse> {
    return queryClient.fetchQuery({
      queryKey: SYNC_STATE_QUERY_KEY,
      queryFn: fetchState,
      staleTime: 0,
    });
  }

  async function reconcile(known?: SyncMeta): Promise<void> {
    if (running || applying) return;
    // Mid-generation state is incomplete; wait for the turn to finish rather
    // than serializing (and uploading) a half-written message.
    if (isBusy()) return;

    running = true;
    syncState.phase = "syncing";
    try {
      if (localMeta.value.dirty) {
        // Cloud-first: the PUT response already carries the authoritative state,
        // so a local change costs exactly one round trip. If another device got
        // there first, compare-and-swap returns 409 and `push` merges + retries.
        await push(localMeta.value.baseRevision, collectPayload());
      } else {
        await pull(known ?? (await fetchMetaOnce()));
      }
      settle();
    } catch (err) {
      fail(err);
    } finally {
      running = false;
    }
  }

  syncNow = () => reconcile();

  // Let the stores report changes, and let byte accounting serialize state.
  setPushScheduler(() => debouncedSync());
  setPayloadCollector(() => collectPayload());

  // Local conversation/gallery changes mark the state as needing an upload.
  watch(
    [() => chatStore.conversations, () => drawStore.gallery],
    () => {
      if (applying) return;
      markDirty();
    },
    { deep: true },
  );

  // Defaults carry their own timestamp so the newest choice wins on merge.
  watch(
    defaultOptions,
    () => {
      if (applying) return;
      localMeta.value.defaultsUpdatedAt = Date.now();
      markDirty();
    },
    { deep: true },
  );

  // The poll is how changes made on other devices arrive.
  watch(
    () => metaQuery.data.value,
    (meta) => {
      if (meta) void reconcile(meta);
    },
    { immediate: true },
  );

  // A long generation stream suppresses pushes; this bounds how long local
  // changes can stay unsynced once the stream ends.
  useIntervalFn(() => {
    if (localMeta.value.dirty) void reconcile();
  }, MAX_LATENCY_MS);

  watch(
    () => metaQuery.error.value,
    (err) => {
      if (err) fail(err);
    },
  );

  onScopeDispose(() => {
    setPushScheduler(null);
    setPayloadCollector(null);
    syncNow = null;
  });
}

/** Forget the server copy and re-upload this device's state. */
export async function resetSyncState(): Promise<void> {
  const res = await request("/api/sync", { method: "DELETE" });
  if (!res.ok) throw await httpError(res);
  localMeta.value.baseRevision = 0;
  localMeta.value.dirty = true;
  syncNow?.();
}
