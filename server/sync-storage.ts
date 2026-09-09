// KV access for the single synced-state entry, shared by the sync routes and
// the image route (which checks the stored size before generating).
//
// The whole app state lives in ONE key, so its size is a first-class concern:
// `readSyncMeta` exposes that size cheaply (KV `list` returns key metadata
// without reading the potentially multi-megabyte value).

import {
  SYNC_KEY,
  parseSyncPayload,
  type SyncMeta,
  type SyncPayload,
} from "@shared/sync";
import { CORRUPT_STATE } from "@shared/errors";
import { UserFacingError } from "./errors";

/** Metadata stored alongside the KV value (KV caps metadata at 1 KiB). */
export interface StoredMeta {
  revision: number;
  updatedAt: number;
  bytes: number;
}

const EMPTY_META: StoredMeta = { revision: 0, updatedAt: 0, bytes: 0 };

/** A stored value we cannot trust: reported as 503 + `corrupt-state`. */
function corruptState(reason: string): UserFacingError {
  return new UserFacingError(`${reason} Reset it to continue.`, {
    status: 503,
    code: CORRUPT_STATE,
  });
}

/**
 * Read and validate the stored state.
 *
 * A corrupt value is reported as an error rather than treated as "empty": the
 * client would otherwise happily overwrite it, silently destroying history. The
 * `corrupt-state` code lets the client offer its reset action.
 */
export async function readState(
  env: Env,
): Promise<{ payload: SyncPayload | null; meta: StoredMeta }> {
  const { value, metadata } = await env.SYNC_KV.getWithMetadata<StoredMeta>(
    SYNC_KEY,
    "text",
  );
  if (value === null) {
    return { payload: null, meta: { ...EMPTY_META } };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw corruptState("Stored sync state is not valid JSON.");
  }

  const payload = parseSyncPayload(raw);
  if (!payload) {
    throw corruptState("Stored sync state failed validation.");
  }

  // Metadata is written on every put; the fallback only covers values written
  // by something other than this worker.
  const meta: StoredMeta = {
    revision: metadata?.revision ?? payload.revision,
    updatedAt: metadata?.updatedAt ?? payload.updatedAt,
    bytes: metadata?.bytes ?? new TextEncoder().encode(value).length,
  };
  return { payload, meta };
}

/** Cheap description of the stored value, without downloading it. */
export async function readSyncMeta(env: Env): Promise<SyncMeta> {
  const list = await env.SYNC_KV.list({ prefix: SYNC_KEY });
  const entry = list.keys.find((key) => key.name === SYNC_KEY);
  const meta = (entry?.metadata ?? null) as StoredMeta | null;

  return {
    revision: meta?.revision ?? 0,
    updatedAt: meta?.updatedAt ?? 0,
    bytes: meta?.bytes ?? 0,
    empty: entry === undefined,
  };
}
