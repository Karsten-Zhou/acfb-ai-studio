// Cross-device sync endpoints, backed by a single Cloudflare KV value.
//
// Local development uses Miniflare's simulated namespace (see `wrangler.jsonc`)
// so nothing here touches a real Cloudflare resource.
//
// Concurrency is handled with compare-and-swap: a client sends the revision it
// last saw, and a stale write is rejected with 409 plus the current state so the
// client can merge and retry.

import { Hono } from "hono";
import {
  SYNC_KEY,
  SYNC_MAX_BYTES,
  parseSyncPushRequest,
  type SyncPayload,
} from "@shared/sync";
import { errorResponse } from "./errors";
import { readState, readSyncMeta, type StoredMeta } from "./sync-storage";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Cheap polling endpoint. KV `list` returns key metadata without reading the
 * (potentially multi-megabyte) value, so clients can watch for changes cheaply.
 */
app.get("/meta", async (c) => {
  try {
    return c.json(await readSyncMeta(c.env));
  } catch (err) {
    return errorResponse(err);
  }
});

/** Full state download. */
app.get("/", async (c) => {
  try {
    const { payload, meta } = await readState(c.env);
    if (!payload) {
      return c.json({ payload: null, revision: 0, bytes: 0 });
    }
    return c.json({ payload, revision: meta.revision, bytes: meta.bytes });
  } catch (err) {
    return errorResponse(err);
  }
});

/** Compare-and-swap upload. */
app.put("/", async (c) => {
  // Read the body once — re-serializing a multi-megabyte payload is wasteful.
  let raw: string;
  try {
    raw = await c.req.text();
  } catch {
    return c.json({ error: "Could not read the request body." }, 400);
  }

  // Cheap early guard: UTF-8 byte length is always >= the UTF-16 string length,
  // so a string longer than the cap is guaranteed to be over it.
  if (raw.length > SYNC_MAX_BYTES) {
    return c.json({ error: tooLargeMessage(raw.length), bytes: raw.length }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "Request body is not valid JSON." }, 400);
  }

  const parsedPush = parseSyncPushRequest(body);
  if (!parsedPush.ok) {
    return c.json(
      {
        error: `Request body is not a valid sync payload (${parsedPush.issues}).`,
      },
      400,
    );
  }
  const request = parsedPush.request;

  try {
    const current = await readState(c.env);
    const currentRevision = current.payload ? current.meta.revision : 0;

    if (currentRevision !== request.baseRevision) {
      return c.json(
        {
          error: "conflict",
          payload: current.payload,
          revision: currentRevision,
          bytes: current.meta.bytes,
        },
        409,
      );
    }

    // Revisions are monotonic so an unchanged base never accidentally matches
    // after a write in the same millisecond.
    const revision = Math.max(Date.now(), currentRevision + 1);
    const submitted: SyncPayload = { ...request.payload, revision };
    const stored = JSON.stringify(submitted);
    const bytes = new TextEncoder().encode(stored).length;

    if (bytes > SYNC_MAX_BYTES) {
      return c.json({ error: tooLargeMessage(bytes), bytes }, 413);
    }

    await c.env.SYNC_KV.put(SYNC_KEY, stored, {
      metadata: { revision, updatedAt: Date.now(), bytes } satisfies StoredMeta,
    });
    return c.json({ payload: submitted, revision, bytes });
  } catch (err) {
    return errorResponse(err);
  }
});

/** Wipe the stored state (used by the "reset sync" action). */
app.delete("/", async (c) => {
  try {
    await c.env.SYNC_KV.delete(SYNC_KEY);
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
});

function tooLargeMessage(bytes: number): string {
  const mb = (bytes / 1024 / 1024).toFixed(1);
  const maxMb = (SYNC_MAX_BYTES / 1024 / 1024).toFixed(0);
  return `History is ${mb} MB, over the ${maxMb} MB single-entry limit. Delete some conversations or images to resume syncing.`;
}

export default app;
