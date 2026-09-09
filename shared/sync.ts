// Cross-device sync contract, shared by the browser and the Worker
// (`@shared/sync`).
//
// The entire app state — conversations, generated images and defaults — lives
// in ONE Cloudflare KV value. A single value keeps the design simple (no key
// bookkeeping, atomic reads) at the cost of Cloudflare's 25 MiB per-value
// limit, which we enforce with a safety margin (see `SYNC_SOFT_LIMIT_BYTES`).
//
// Conflict handling is last-write-wins *per item*: conversations are compared
// by `updatedAt`, gallery items by `createdAt`. Deletions are recorded as
// tombstones so a delete on one device is not resurrected by another device
// that still holds a copy.

import z from "zod";
import type { Conversation, DefaultChatOptions } from "./chat";
import type { GalleryItem } from "./draw";

/** KV key holding the whole synced state. */
export const SYNC_KEY = "state";

/** Schema version of the stored payload (bump on breaking changes). */
export const SYNC_VERSION = 2;

/** Cloudflare's hard limit for a single KV value: 25 MiB. */
export const SYNC_MAX_BYTES = 25 * 1024 * 1024;

/** Fraction of `SYNC_MAX_BYTES` we allow before blocking new generations. */
export const SYNC_SAFETY_RATIO = 0.8;

/**
 * Soft ceiling (80% of 25 MiB = 20 MiB). Past this point new image generations
 * are refused so the user has to prune history instead of hitting the hard
 * limit and losing sync entirely.
 */
export const SYNC_SOFT_LIMIT_BYTES = Math.floor(
  SYNC_MAX_BYTES * SYNC_SAFETY_RATIO,
);

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------
//
// Validation is intentionally *loose* (`looseObject` keeps unknown keys rather
// than stripping them) so an older server never silently drops fields written
// by a newer client. Walking the arrays is cheap: the large strings (image data
// URLs) are only type-checked, never inspected.

const reasoningEffortSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
]);

const generationParamsSchema = z.looseObject({
  temperature: z.number().optional(),
  topP: z.number().optional(),
  stream: z.boolean().optional(),
});

const chatMessageSchema = z.looseObject({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.number(),
  reasoning: z.string().optional(),
  activeChildId: z.string().optional(),
  error: z.string().optional(),
});

const conversationSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  model: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(chatMessageSchema),
  leafId: z.string().nullable(),
});

const galleryItemSchema = z.looseObject({
  id: z.string().min(1),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  model: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  seed: z.number().optional(),
  image: z.string(),
  createdAt: z.number(),
});

const defaultsSchema = z.looseObject({
  model: z.string(),
  reasoningEffort: reasoningEffortSchema,
  params: generationParamsSchema,
  drawModel: z.string().optional(),
});

export const syncPayloadSchema = z.looseObject({
  version: z.number().int(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number(),
  conversations: z.array(conversationSchema),
  gallery: z.array(galleryItemSchema),
  defaults: defaultsSchema,
  defaultsUpdatedAt: z.number(),
  /**
   * Tombstones: item id -> deletion time (ms). Retained indefinitely because a
   * device may be offline for an arbitrary time and would otherwise resurrect
   * deleted items. They are ~60 bytes each, so growth is negligible.
   */
  deletions: z.record(z.string(), z.number()),
});

/** The whole synced state, as stored in KV. */
export interface SyncPayload {
  version: number;
  revision: number;
  updatedAt: number;
  conversations: Conversation[];
  gallery: GalleryItem[];
  defaults: DefaultChatOptions;
  defaultsUpdatedAt: number;
  /**
   * Tombstones: item id -> deletion time (ms). Retained indefinitely because a
   * device may be offline for an arbitrary time and would otherwise resurrect
   * deleted items. They are ~60 bytes each, so growth is negligible.
   */
  deletions: Record<string, number>;
}

// Compile-time guard that the runtime schema and the interface above stay in
// step: if a field is added or retyped in one place only, this stops building.
type SchemaMatchesPayload = z.infer<
  typeof syncPayloadSchema
> extends SyncPayload
  ? true
  : never;
const _schemaMatchesPayload: SchemaMatchesPayload = true;
void _schemaMatchesPayload;

/** Cheap description of the stored value, used to poll without downloading. */
export interface SyncMeta {
  revision: number;
  updatedAt: number;
  bytes: number;
  empty: boolean;
}

/** Body of `PUT /api/sync`. */
export interface SyncPushRequest {
  /** Revision the client believes is current; used for compare-and-swap. */
  baseRevision: number;
  payload: SyncPayload;
}

/** Successful response of `GET`/`PUT /api/sync`. */
export interface SyncStateResponse {
  payload: SyncPayload;
  revision: number;
  bytes: number;
}

/** Response of a `PUT` that lost the compare-and-swap (HTTP 409). */
export interface SyncConflictResponse {
  error: "conflict";
  payload: SyncPayload | null;
  revision: number;
  bytes: number;
}

/**
 * Validate an unknown value as a sync payload. Returns `null` when the value is
 * not a usable payload, so callers can respond with a clear error instead of
 * writing garbage into KV.
 */
export function parseSyncPayload(value: unknown): SyncPayload | null {
  const parsed = syncPayloadSchema.safeParse(value);
  return parsed.success ? (parsed.data as SyncPayload) : null;
}

/** Compact `path: message` summary of the first few validation problems. */
export function formatZodIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Explain why a value is not a valid payload, naming the offending field.
 *
 * Without this a bad payload is just "invalid", which is impossible to act on.
 * Returns an empty string when the value is valid.
 */
export function describePayloadIssues(value: unknown): string {
  const parsed = syncPayloadSchema.safeParse(value);
  return parsed.success ? "" : formatZodIssues(parsed.error.issues);
}

/** Wire format of `PUT /api/sync`: a compare-and-swap envelope. */
export const syncPushRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  payload: z.unknown(),
});

export type ParsedSyncPushRequest =
  | { ok: true; request: SyncPushRequest }
  | { ok: false; issues: string };

/**
 * Parse the body of `PUT /api/sync`.
 *
 * Shared by both sides so the encoder and decoder cannot drift: the client
 * serializes with `encodeSyncPush` and the worker parses with this.
 */
export function parseSyncPushRequest(value: unknown): ParsedSyncPushRequest {
  const envelope = syncPushRequestSchema.safeParse(value);
  if (!envelope.success) {
    return { ok: false, issues: formatZodIssues(envelope.error.issues) };
  }
  const payload = parseSyncPayload(envelope.data.payload);
  if (!payload) {
    return { ok: false, issues: describePayloadIssues(envelope.data.payload) };
  }
  return {
    ok: true,
    request: { baseRevision: envelope.data.baseRevision, payload },
  };
}

/** Serialize the body of `PUT /api/sync`. */
export function encodeSyncPush(request: SyncPushRequest): string {
  return JSON.stringify(request);
}

/** Byte length of a value once serialized as JSON (what KV actually stores). */
export function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Human-readable megabyte value, e.g. `18.4`. */
export function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Why new images are refused once the soft limit is reached.
 *
 * Shared so the client's local precheck and the worker's authoritative one say
 * exactly the same thing.
 */
export function softLimitMessage(bytes: number): string {
  return (
    `History is using ${formatMb(bytes)} MB of the ${formatMb(SYNC_MAX_BYTES)} MB ` +
    "sync limit. Delete some images or conversations before generating more."
  );
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeResult {
  payload: SyncPayload;
  /** The merged state holds something the local state did not have. */
  changedLocal: boolean;
  /** The merged state holds something the remote state did not have. */
  changedRemote: boolean;
}

/** True when both maps hold exactly the same keys and values. */
function sameNumberMap(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/**
 * Merge two item lists by id, keeping the newest version of each item and
 * dropping any item covered by a tombstone.
 *
 * Ordering is derived from `atOf` descending (with the id as a tiebreak) rather
 * than from either input, so both devices converge on the same array order.
 *
 * Ties (same id *and* same version timestamp) are treated as the same write and
 * our own copy is kept. Every mutation bumps the timestamp, so a genuine
 * conflict cannot land on an identical millisecond; treating a tie as "equal"
 * is what stops an in-sync pair of devices from rewriting each other's stores
 * on every poll.
 */
function mergeItems<T>(
  local: T[],
  remote: T[],
  idOf: (item: T) => string,
  atOf: (item: T) => number,
  deletions: Record<string, number>,
): { items: T[]; changedLocal: boolean; changedRemote: boolean } {
  const localById = new Map(local.map((item) => [idOf(item), item]));
  const remoteById = new Map(remote.map((item) => [idOf(item), item]));

  const items: T[] = [];
  /** Copies that exist on one side and are already represented by the other. */
  const equivalent = new Set<T>();

  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);

    let winner: T | undefined;
    let tied = false;
    if (localItem && remoteItem) {
      const localAt = atOf(localItem);
      const remoteAt = atOf(remoteItem);
      if (localAt === remoteAt) {
        winner = localItem;
        tied = true;
      } else {
        // Last write wins. Not a tie, so the choice is unambiguous.
        winner = localAt > remoteAt ? localItem : remoteItem;
      }
    } else {
      winner = localItem ?? remoteItem;
    }

    if (!winner) continue;
    if (deletions[id] !== undefined && deletions[id] >= atOf(winner)) continue;

    items.push(winner);
    if (tied && remoteItem) equivalent.add(remoteItem);
  }

  items.sort((a, b) => atOf(b) - atOf(a) || idOf(a).localeCompare(idOf(b)));

  // Membership (not order) decides whether either side actually changed.
  const present = new Set([...items, ...equivalent]);
  return {
    items,
    changedLocal:
      items.length !== local.length || local.some((item) => !present.has(item)),
    changedRemote:
      items.length !== remote.length || remote.some((item) => !present.has(item)),
  };
}

/**
 * Reconcile a local and a remote payload. Pure: it touches no store, so it can
 * be unit-tested and reused by the client on both pull and conflict responses.
 *
 * The two `changed*` flags tell the caller what to do next: `changedLocal` means
 * the in-memory stores need updating, `changedRemote` means the merged result
 * still has to be pushed back to the server.
 */
export function mergePayloads(
  local: SyncPayload,
  remote: SyncPayload,
): MergeResult {
  const deletions: Record<string, number> = { ...remote.deletions };
  for (const [id, at] of Object.entries(local.deletions)) {
    deletions[id] = Math.max(deletions[id] ?? 0, at);
  }

  const conversations = mergeItems(
    local.conversations,
    remote.conversations,
    (c) => c.id,
    (c) => c.updatedAt,
    deletions,
  );
  const gallery = mergeItems(
    local.gallery,
    remote.gallery,
    (g) => g.id,
    (g) => g.createdAt,
    deletions,
  );

  const defaults =
    local.defaultsUpdatedAt > remote.defaultsUpdatedAt
      ? local.defaults
      : remote.defaults;
  // Compare by value, not identity: identical defaults must not register as a
  // change on either side (otherwise every sync would trigger a pointless
  // apply/push round trip).
  const defaultsChanged =
    JSON.stringify(local.defaults) !== JSON.stringify(remote.defaults);

  return {
    payload: {
      version: SYNC_VERSION,
      revision: Math.max(local.revision, remote.revision),
      updatedAt: Math.max(local.updatedAt, remote.updatedAt),
      conversations: conversations.items,
      gallery: gallery.items,
      defaults,
      defaultsUpdatedAt: Math.max(
        local.defaultsUpdatedAt,
        remote.defaultsUpdatedAt,
      ),
      deletions,
    },
    changedLocal:
      conversations.changedLocal ||
      gallery.changedLocal ||
      (defaultsChanged && defaults !== local.defaults) ||
      !sameNumberMap(deletions, local.deletions),
    changedRemote:
      conversations.changedRemote ||
      gallery.changedRemote ||
      (defaultsChanged && defaults !== remote.defaults) ||
      !sameNumberMap(deletions, remote.deletions),
  };
}
