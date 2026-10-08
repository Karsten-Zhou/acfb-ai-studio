// Llama.cpp-compatible conversation backup & restore.
//
// The file format mirrors llama.cpp's web UI (`tools/ui`, ConversationTransferService):
//
// - A single conversation is a **JSONL** file: one record per line. The first
//   line is a session record (`{"harness":"llama.app","type":"session", ...conversation
//   fields}`); every following line is a message record (`{"type":"message",
//   "message": {...}}`). Multiple sessions may share one file.
// - Several conversations are a **ZIP** with one `.jsonl` file per conversation.
// - Import detects the format from the bytes: `PK` magic -> ZIP; first non-empty
//   line with `type: "session"` -> JSONL; otherwise a legacy JSON export
//   (`{conv, messages}` / array of those / bare message list / this app's former
//   bundle) is accepted too.
//
// Message records carry the flat tree the app stores (id, parent, children,
// timestamp, role, content, reasoningContent, extra images), and the session
// record carries `currNode` (the active leaf), so sibling branches survive a
// round trip. On import, conversations get fresh ids (copies, never overwrites);
// tool-role messages (which the app's schema cannot represent) are dropped.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Attachment, ChatMessage, Conversation } from "@shared/chat";
import { autoTitle } from "@/lib/titles";

// Format markers, taken verbatim from llama.cpp's UI constants/enums.
const HARNESS = "llama.app";
const RECORD_SESSION = "session";
const RECORD_MESSAGE = "message";
const ZIP_MAGIC = [0x50, 0x4b]; // "PK"
const ATTACHMENT_TYPE_IMAGE = "IMAGE";
const FILE_JSONL = ".jsonl";
const FILE_ZIP = ".zip";
const MIME_JSONL = "application/jsonl";
const MIME_ZIP = "application/zip";
const ID_TRIM_LENGTH = 8;
const NAME_SUFFIX_MAX_LENGTH = 20;

const VALID_ROLES = new Set(["system", "user", "assistant"]);

export type BackupParseResult =
  | { ok: true; conversations: Conversation[]; skipped: number }
  | { ok: false; error: string };

export interface ExportResult {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
}

/** One llama.cpp message record payload (DatabaseMessage-compatible subset). */
interface LlamaMessageRecord {
  id: string;
  convId: string;
  type: string;
  timestamp: number;
  role: string;
  content: string;
  parent: string | null;
  children: string[];
  reasoningContent?: string;
  extra?: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function messageAttachmentsToExtra(
  m: ChatMessage,
): Array<Record<string, unknown>> | undefined {
  if (!m.attachments || m.attachments.length === 0) return undefined;
  return m.attachments.map((a) => ({
    type: ATTACHMENT_TYPE_IMAGE,
    name: a.name ?? "",
    mimeType: a.mimeType,
    base64Url: a.dataUrl,
  }));
}

function messageRecord(
  conv: Conversation,
  m: ChatMessage,
  children: string[],
): LlamaMessageRecord {
  const isRoot = m.parentId === null;
  const type = m.role === "system" ? "system" : isRoot ? "root" : "text";
  const extra = messageAttachmentsToExtra(m);
  return {
    id: m.id,
    convId: conv.id,
    type,
    timestamp: m.createdAt,
    role: m.role,
    content: m.content,
    parent: m.parentId,
    children,
    ...(m.reasoning ? { reasoningContent: m.reasoning } : {}),
    ...(extra ? { extra } : {}),
  };
}

function conversationToSession(conv: Conversation): {
  session: Record<string, unknown>;
  messages: LlamaMessageRecord[];
} {
  // Export the full tree (not just the active thread) so sibling branches
  // survive; `currNode` tells llama.cpp which branch is active. Failed turns
  // (transient UI state, never real content) are dropped.
  const byId = new Map(conv.messages.map((m) => [m.id, m]));
  const byParent = new Map<string, string[]>();
  const live: ChatMessage[] = [];
  for (const m of conv.messages) {
    if (m.error) continue;
    live.push(m);
    const list = byParent.get(m.parentId ?? "") ?? [];
    list.push(m.id);
    byParent.set(m.parentId ?? "", list);
  }
  const idSet = new Set(live.map((m) => m.id));
  const childrenOf = (parentId: string | null): string[] => {
    const list = byParent.get(parentId ?? "") ?? [];
    return list
      .filter((cid) => idSet.has(cid))
      .sort(
        (a, b) => (byId.get(a)?.createdAt ?? 0) - (byId.get(b)?.createdAt ?? 0),
      );
  };

  return {
    session: {
      harness: HARNESS,
      type: RECORD_SESSION,
      id: conv.id,
      name: conv.title,
      lastModified: conv.updatedAt,
      currNode: conv.leafId,
      model: conv.model,
    },
    messages: live.map((m) => messageRecord(conv, m, childrenOf(m.id))),
  };
}

/** One conversation as a llama.cpp JSONL history file (session + messages). */
export function serializeConversation(conv: Conversation): string {
  const { session, messages } = conversationToSession(conv);
  return [
    JSON.stringify(session),
    ...messages.map((m) =>
      JSON.stringify({ type: RECORD_MESSAGE, message: m }),
    ),
  ].join("\n");
}

/** llama.cpp naming: `<YYYY-MM-DD_HH-MM-SS>_conv_<id8>_<name20>.jsonl`. */
export function conversationFileName(conv: Conversation): string {
  const name = (conv.title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, NAME_SUFFIX_MAX_LENGTH);

  const newest = conv.messages.reduce(
    (max, m) => Math.max(max, m.createdAt),
    -Infinity,
  );
  const referenceDate = Number.isFinite(newest) ? newest : Date.now();
  const iso = new Date(referenceDate)
    .toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replaceAll(":", "-");
  const id8 = conv.id.slice(0, ID_TRIM_LENGTH);

  return `${iso}_conv_${id8}_${name}${FILE_JSONL}`;
}

/** `<YYYY-MM-DD>_conversations.zip` — llama.cpp's archive naming. */
export function conversationsArchiveFileName(): string {
  const date = new Date().toISOString().split("T")[0];
  return `${date}_conversations${FILE_ZIP}`;
}

/**
 * Export one conversation as JSONL or several as a ZIP of JSONL files —
 * matching llama.cpp's single-vs-archive behavior.
 */
export function exportConversations(
  conversations: Conversation[],
): ExportResult {
  if (conversations.length === 1) {
    const [conv] = conversations;
    return {
      filename: conversationFileName(conv),
      bytes: strToU8(serializeConversation(conv)),
      mimeType: MIME_JSONL,
    };
  }

  const usedNames = new Set<string>();
  const files: Record<string, Uint8Array> = {};
  for (const conv of conversations) {
    let entryName = conversationFileName(conv);
    let suffix = 1;
    while (usedNames.has(entryName)) {
      entryName = entryName.replace(/\.jsonl$/, `_${suffix++}${FILE_JSONL}`);
    }
    usedNames.add(entryName);
    files[entryName] = strToU8(serializeConversation(conv));
  }

  return {
    filename: conversationsArchiveFileName(),
    bytes: zipSync(files),
    mimeType: MIME_ZIP,
  };
}

/**
 * A BlobPart without fflate's `Uint8Array<ArrayBufferLike>` generic, which the
 * DOM `BlobPart` type rejects. Copies into a plain ArrayBuffer-backed view.
 */
function toBlobData(data: Uint8Array | string): BlobPart {
  if (typeof data === "string") return data;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

/** Trigger a browser download of text or binary data. */
export function downloadFile(
  filename: string,
  data: Uint8Array | string,
  mimeType = "application/octet-stream",
): void {
  const blob = new Blob([toBlobData(data)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Parse one JSONL text into raw sessions (llama.cpp's parseSessionsJsonl). */
function parseSessionsJsonl(text: string): SessionLike[] {
  const sessions: SessionLike[] = [];
  let current: SessionLike | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `Invalid JSONL record: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    if (!isRecord(record)) continue;

    if (record.type === RECORD_SESSION) {
      current = { conv: record, messages: [] };
      sessions.push(current);
    } else if (record.type === RECORD_MESSAGE) {
      if (!current) {
        throw new Error(
          "Invalid JSONL: message record before any session record",
        );
      }
      if (isRecord(record.message)) {
        current.messages.push(record.message);
      }
    }
    // Unknown record types are ignored for forward compatibility.
  }

  return sessions;
}

/** Raw session shape: the conversation record plus its flat messages. */
interface SessionLike {
  conv: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
}

/**
 * Legacy JSON shapes accepted on import: llama.cpp's old `{conv, messages}`
 * export (single object or array), a bare `{messages: [...]}` list, and this
 * app's former bundle (`{kind:"conversation-backup", conversations: [...]}`).
 */
function normalizeLegacy(root: unknown): SessionLike[] {
  const out: SessionLike[] = [];

  const push = (value: unknown) => {
    if (!isRecord(value)) return;

    if (isRecord(value.conv) && Array.isArray(value.messages)) {
      out.push({
        conv: value.conv,
        messages: normalizeMessages(value.messages),
      });
      return;
    }

    if (Array.isArray(value.conversations)) {
      for (const item of value.conversations) {
        if (!isRecord(item)) continue;
        const messages = normalizeMessages(item.messages);
        if (messages.length === 0) continue;
        out.push({
          conv: {
            name: asString(item.title),
            model: asString(item.model),
            createdAt: asNumber(item.createdAt),
            lastModified: asNumber(item.updatedAt),
          },
          messages,
        });
      }
      return;
    }

    const messages = normalizeMessages(value.messages);
    if (messages.length === 0) return;
    out.push({
      conv: {
        name: asString(value.title),
        model: asString(value.model),
        createdAt: asNumber(value.createdAt),
        lastModified: asNumber(value.updatedAt),
      },
      messages,
    });
  };

  if (Array.isArray(root)) {
    root.forEach(push);
  } else if (isRecord(root)) {
    push(root);
  }
  return out;
}

function normalizeMessages(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is Record<string, unknown> => isRecord(m));
}

/** Split one OpenAI-style content value into text + embedded image URLs. */
function normalizeContent(content: unknown): {
  text: string;
  images: string[];
} {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: "", images: [] };

  let text = "";
  const images: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      text += text ? `\n\n${part.text}` : part.text;
    } else if (
      part.type === "image_url" &&
      isRecord(part.image_url) &&
      typeof part.image_url.url === "string"
    ) {
      images.push(part.image_url.url);
    }
  }
  return { text, images };
}

function mimeTypeOf(dataUrl: string): string {
  const match = /^data:([^;,]+)/.exec(dataUrl);
  return match?.[1] || "application/octet-stream";
}

function buildAttachment(
  dataUrl: string,
  mimeType?: string,
  name?: string,
): Attachment {
  return {
    id: crypto.randomUUID(),
    dataUrl,
    mimeType: mimeType || mimeTypeOf(dataUrl),
    ...(name ? { name } : {}),
  };
}

/** Attachments from a llama.cpp message record (`extra` images). */
function attachmentsFromMessage(
  message: Record<string, unknown>,
): Attachment[] | undefined {
  const out: Attachment[] = [];
  const extras = Array.isArray(message.extra) ? message.extra : [];

  for (const extra of extras) {
    if (!isRecord(extra)) continue;
    const base64Url = asString(extra.base64Url);
    if (base64Url) {
      out.push(
        buildAttachment(
          base64Url,
          asString(extra.mimeType),
          asString(extra.name),
        ),
      );
      continue;
    }
    const base64Data = asString(extra.base64Data);
    const mimeType = asString(extra.mimeType);
    if (base64Data && mimeType) {
      out.push(
        buildAttachment(
          `data:${mimeType};base64,${base64Data}`,
          mimeType,
          asString(extra.name),
        ),
      );
    }
  }

  return out.length > 0 ? out : undefined;
}

/**
 * Parse an import file: llama.cpp JSONL, ZIP of JSONL, or any legacy JSON
 * shape. Returns import-ready conversations (fresh ids) plus how many
 * conversation objects were skipped for having no usable messages.
 */
export function parseBackupFile(
  bytes: Uint8Array,
  opts: { model: string; defaultTitle: string },
): BackupParseResult {
  const isZip = ZIP_MAGIC.every((byte, index) => bytes[index] === byte);

  let sessions: SessionLike[];
  try {
    if (isZip) {
      const entries = unzipSync(bytes);
      sessions = [];
      for (const [name, entryBytes] of Object.entries(entries)) {
        if (!name.toLowerCase().endsWith(FILE_JSONL)) continue;
        sessions.push(...parseSessionsJsonl(strFromU8(entryBytes)));
      }
    } else {
      const text = strFromU8(bytes);
      let isJsonl = false;
      const firstLine = text.trimStart().split("\n", 1)[0]?.trim() ?? "";
      try {
        const parsed = JSON.parse(firstLine);
        isJsonl = isRecord(parsed) && parsed.type === RECORD_SESSION;
      } catch {
        isJsonl = false;
      }

      if (isJsonl) {
        sessions = parseSessionsJsonl(text);
      } else {
        let root: unknown;
        try {
          root = JSON.parse(text);
        } catch (err) {
          return {
            ok: false,
            error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        sessions = normalizeLegacy(root);
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (sessions.length === 0) {
    return { ok: false, error: "No conversations found in this file." };
  }

  const conversations: Conversation[] = [];
  for (const session of sessions) {
    const built = buildConversation(session, opts);
    if (built) conversations.push(built);
  }

  if (conversations.length === 0) {
    return {
      ok: false,
      error: "No conversations with usable messages found in this file.",
    };
  }
  const skipped = sessions.length - conversations.length;
  return { ok: true, conversations, skipped };
}

/** Rebuild one app conversation from a raw session (fresh ids, full tree). */
function buildConversation(
  raw: SessionLike,
  opts: { model: string; defaultTitle: string },
): Conversation | null {
  // -- Keep only representable roles; drop messages whose parent chain broke
  //    (e.g. tool messages removed with their tool-call siblings).
  let kept: Array<Record<string, unknown>> = raw.messages.filter((m) => {
    const role = asString(m.role)?.toLowerCase() ?? "";
    return VALID_ROLES.has(role);
  });
  let changed = true;
  while (changed) {
    changed = false;
    const ids = new Set(kept.map((m) => asString(m.id)).filter(Boolean));
    const filtered: Array<Record<string, unknown>> = [];
    for (const m of kept) {
      const parent = asString(m.parent);
      if (parent && !ids.has(parent)) {
        changed = true;
        continue;
      }
      filtered.push(m);
    }
    kept = filtered;
  }
  if (kept.length === 0) return null;

  // -- Fresh ids.
  const idMap = new Map<string, string>();
  for (const m of kept) {
    const oldId = asString(m.id);
    if (oldId) idMap.set(oldId, crypto.randomUUID());
  }

  // -- Parent/children (old ids) + active leaf path for `activeChildId`.
  const parentOf = new Map<string, string | null>();
  const childrenByParent = new Map<string, string[]>();
  for (const m of kept) {
    const oldId = asString(m.id);
    const parent = asString(m.parent) ?? null;
    if (!oldId) continue;
    parentOf.set(oldId, parent);
    if (parent) {
      const list = childrenByParent.get(parent) ?? [];
      list.push(oldId);
      childrenByParent.set(parent, list);
    }
  }

  const leafOldId = asString(raw.conv.currNode);
  const onPath = new Set<string>();
  if (leafOldId && idMap.has(leafOldId)) {
    let cursor: string | null = leafOldId;
    while (cursor) {
      onPath.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  const messages: ChatMessage[] = kept.map((m) => {
    const oldId = asString(m.id);
    const parent = asString(m.parent) ?? null;
    const children = childrenByParent.get(oldId ?? "") ?? [];
    const activeChildId = children.find((c) => onPath.has(c)) ?? null;

    const timestamp = asNumber(m.timestamp) ?? Date.now();
    const { text, images: contentImages } = normalizeContent(m.content);
    const legacyImages = Array.isArray(m.images)
      ? m.images.filter((img): img is string => typeof img === "string")
      : [];
    const allImages = [...contentImages, ...legacyImages];
    const attachments =
      attachmentsFromMessage(m) ??
      (allImages.length > 0
        ? allImages.map((url) => buildAttachment(url))
        : undefined);

    return {
      id: idMap.get(oldId ?? "") ?? crypto.randomUUID(),
      parentId: parent && idMap.has(parent) ? idMap.get(parent)! : null,
      role: (asString(m.role)?.toLowerCase() ?? "user") as ChatMessage["role"],
      content: text,
      createdAt: timestamp,
      ...(asString(m.reasoningContent)
        ? { reasoning: asString(m.reasoningContent)! }
        : {}),
      ...(attachments ? { attachments } : {}),
      ...(activeChildId ? { activeChildId: idMap.get(activeChildId)! } : {}),
    };
  });

  // Bare message lists (no `parent` relationships in the file, e.g. this app's
  // former export or OpenAI-style histories) restore as one linear thread.
  if (messages.length > 1 && messages.every((m) => m.parentId === null)) {
    for (let i = 1; i < messages.length; i++) {
      messages[i].parentId = messages[i - 1].id;
    }
  }

  // -- Leaf: prefer the file's currNode; otherwise the newest message
  //    (ties keep the last in file order, which is chronological).
  let leafId: string | null;
  if (leafOldId && idMap.has(leafOldId)) {
    leafId = idMap.get(leafOldId)!;
  } else {
    leafId =
      messages.reduce(
        (newest, m) => (m.createdAt >= newest.createdAt ? m : newest),
        messages[0],
      )?.id ?? null;
  }

  const title = asString(raw.conv.name)?.trim();
  const firstUser = messages.find((m) => m.role === "user");
  const fallbackTitle =
    autoTitle(firstUser?.content ?? "") || opts.defaultTitle;
  const createdAt =
    asNumber(raw.conv.createdAt) ??
    (messages.length > 0
      ? Math.min(...messages.map((m) => m.createdAt))
      : Date.now());
  const updatedAt =
    asNumber(raw.conv.lastModified) ??
    (messages.length > 0
      ? Math.max(...messages.map((m) => m.createdAt))
      : Date.now());

  return {
    id: crypto.randomUUID(),
    title: title || fallbackTitle,
    titleSource: title ? "user" : "fallback",
    model: asString(raw.conv.model)?.trim() || opts.model,
    createdAt,
    updatedAt,
    messages,
    leafId,
  };
}
