// Versioned, one-way migration of persisted chat data.
//
// Persisted conversations carry a schema version (the localStorage key suffix,
// or the sync payload's `version`). A registry of step functions upgrades
// version N -> N+1; `migrateConversations` walks that chain from whatever
// version it is handed up to `CHAT_SCHEMA_VERSION`. Adding a future change is
// one new entry in `STEPS` plus a version bump — no caller changes.
//
// This is the only module that understands old message shapes; everything else
// assumes the current format (`segments` present). It runs at the persistence
// boundaries only — localStorage upgrade and sync-payload validation — never in
// the render path.

import type { AssistantSegment } from "./chat";
import { CHAT_SCHEMA_VERSION, STORAGE_KEY_PREFIX } from "./chat";

/**
 * A tool call as persisted before `segments` existed. The canonical `ToolCall`
 * no longer carries these ordering hints; they live only here.
 */
interface LegacyToolCall {
  id: string;
  /** Length of the reply's content when the call happened. */
  contentOffset?: number;
}

/** The legacy fields a pre-`segments` message carried. */
interface LegacyReply {
  content?: string;
  reasoning?: string;
  toolCalls?: readonly LegacyToolCall[];
}

/**
 * Reconstruct an ordered timeline from the flat pre-`segments` fields.
 * Idempotent: a message that already has `segments` is returned unchanged.
 */
export function segmentsFromLegacy(message: LegacyReply): AssistantSegment[] {
  const segments: AssistantSegment[] = [];
  const reasoning = message.reasoning ?? "";
  if (reasoning) segments.push({ type: "reasoning", text: reasoning });

  const content = message.content ?? "";
  const calls = [...(message.toolCalls ?? [])].sort(
    (a, b) => (a.contentOffset ?? 0) - (b.contentOffset ?? 0),
  );
  let cursor = 0;
  for (const call of calls) {
    const offset = Math.max(
      0,
      Math.min(call.contentOffset ?? 0, content.length),
    );
    if (offset > cursor) {
      segments.push({ type: "content", text: content.slice(cursor, offset) });
      cursor = offset;
    }
    segments.push({ type: "tool", id: call.id });
  }
  if (cursor < content.length) {
    segments.push({ type: "content", text: content.slice(cursor) });
  }
  return segments;
}

/** Add `segments` to one raw stored message if it is missing. */
function messageAddSegments(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const message = value as Record<string, unknown>;
  if (Array.isArray(message.segments)) return value;
  const legacy: LegacyReply = {
    content: typeof message.content === "string" ? message.content : undefined,
    reasoning:
      typeof message.reasoning === "string" ? message.reasoning : undefined,
    toolCalls: Array.isArray(message.toolCalls)
      ? (message.toolCalls as LegacyToolCall[])
      : undefined,
  };
  return { ...message, segments: segmentsFromLegacy(legacy) };
}

/** Schema step: ensure every message of every conversation has `segments`. */
function conversationsAddSegments(conversations: unknown): unknown {
  if (!Array.isArray(conversations)) return conversations;
  return conversations.map((conversation) => {
    if (!conversation || typeof conversation !== "object") return conversation;
    const conv = conversation as Record<string, unknown>;
    if (!Array.isArray(conv.messages)) return conversation;
    return { ...conv, messages: conv.messages.map(messageAddSegments) };
  });
}

/**
 * Migration steps: `STEPS[v]` upgrades conversations at schema version `v` to
 * `v + 1`. Versions 1 and 2 shared the pre-`segments` message shape, so both map
 * to the same (idempotent) transform.
 */
const STEPS: Record<number, (conversations: unknown) => unknown> = {
  1: conversationsAddSegments,
  2: conversationsAddSegments,
};

/**
 * Upgrade `conversations` from `fromVersion` to the current schema, running each
 * step in order. Data newer than the current version is passed through
 * untouched (a downgrade, not this function's problem). Throws if a required
 * step is missing, so a forgotten migration fails loudly rather than silently
 * corrupting data.
 */
export function migrateConversations(
  conversations: unknown,
  fromVersion: number,
): unknown {
  let data = conversations;
  for (let v = fromVersion; v < CHAT_SCHEMA_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new Error(`Missing chat migration step ${v} -> ${v + 1}`);
    data = step(data);
  }
  return data;
}

/**
 * Migrate a raw sync payload before validation. The payload's `version` is the
 * schema version of its conversations; anything unexpected is passed through
 * for the schema to reject.
 */
export function migratePayloadRaw(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const obj = payload as Record<string, unknown>;
  if (!("conversations" in obj)) return payload;
  const from = typeof obj.version === "number" ? obj.version : 1;
  return {
    ...obj,
    conversations: migrateConversations(obj.conversations, from),
  };
}

// ---------------------------------------------------------------------------
// localStorage migration
// ---------------------------------------------------------------------------

/**
 * Minimal structural subset of the Web Storage API. `window.localStorage`
 * satisfies it; tests pass a plain in-memory object.
 */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageMigrationResult {
  /** True when conversations were written to the current key. */
  migrated: boolean;
  /** The version migrated from, when `migrated` is true. */
  fromVersion?: number;
  /**
   * Why a legacy payload that *exists* could not be moved. Without it a
   * stranded copy is indistinguishable from "nothing to do", and the caller has
   * nothing to report.
   */
  blocked?: "unparseable" | "write-verification-failed";
  /** The underlying message, when the block came from a thrown error. */
  detail?: string;
}

/**
 * Upgrade persisted conversations from the newest older `…:v<N>` key to the
 * current version.
 *
 * Safety rules, each of which exists because breaking one loses user data:
 * - Never overwrite current-version data that already holds conversations.
 * - An *empty* current key does not count as data, so migration still runs.
 * - Write the new value, read it back, and only then delete the source. An
 *   interrupted or rejected write must never destroy the only copy.
 * - Unparseable legacy data is left in place for manual recovery.
 */
export function migrateChatStorage(
  storage: KeyValueStore,
): StorageMigrationResult {
  const versions: number[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;
    const version = Number(key.slice(STORAGE_KEY_PREFIX.length));
    if (Number.isInteger(version) && version < CHAT_SCHEMA_VERSION) {
      versions.push(version);
    }
  }
  if (versions.length === 0) return { migrated: false };

  const currentKey = `${STORAGE_KEY_PREFIX}${CHAT_SCHEMA_VERSION}`;
  const existing = storage.getItem(currentKey);
  if (existing !== null && existing !== "[]") return { migrated: false };

  const fromVersion = Math.max(...versions);
  const raw = storage.getItem(`${STORAGE_KEY_PREFIX}${fromVersion}`);
  if (raw === null) return { migrated: false };

  let migrated: unknown;
  try {
    migrated = migrateConversations(JSON.parse(raw) as unknown, fromVersion);
  } catch (error) {
    return {
      migrated: false,
      blocked: "unparseable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!Array.isArray(migrated) || migrated.length === 0) {
    return { migrated: false };
  }

  const serialized = JSON.stringify(migrated);
  storage.setItem(currentKey, serialized);
  if (storage.getItem(currentKey) !== serialized) {
    return { migrated: false, blocked: "write-verification-failed" };
  }

  for (const version of versions) {
    storage.removeItem(`${STORAGE_KEY_PREFIX}${version}`);
  }
  return { migrated: true, fromVersion };
}
