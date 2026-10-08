// Tests for the llama.cpp-compatible conversation backup/restore module.
import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { ChatMessage, Conversation } from "@shared/chat";
import {
  conversationsArchiveFileName,
  conversationFileName,
  exportConversations,
  parseBackupFile,
  serializeConversation,
} from "./conversation-backup";

const PARSE_OPTS = {
  model: "fallback-model",
  defaultTitle: "Imported conversation",
};

function msg(
  id: string,
  parentId: string | null,
  role: ChatMessage["role"],
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { id, parentId, role, content, createdAt: 1, ...extra };
}

function conv(
  messages: ChatMessage[],
  title = "Test conversation",
  opts: Partial<Conversation> = {},
): Conversation {
  return {
    id: "conv-1",
    title,
    titleSource: "fallback",
    model: "llama-3.1-8b",
    createdAt: 10,
    updatedAt: 20,
    messages,
    leafId: messages.length > 0 ? messages[messages.length - 1].id : null,
    ...opts,
  };
}

/** Builds a llama.cpp-shaped JSONL file (session header + message records). */
function sessionJsonl(
  convFields: Record<string, unknown>,
  messages: Array<Record<string, unknown>>,
): string {
  const lines = [
    JSON.stringify({ harness: "llama.app", type: "session", ...convFields }),
  ];
  for (const m of messages)
    lines.push(JSON.stringify({ type: "message", message: m }));
  return lines.join("\n");
}

function llamaMessage(
  id: string,
  convId: string,
  parent: string | null,
  role: string,
  content: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    convId,
    type: parent === null ? "root" : "text",
    timestamp: 1,
    role,
    content,
    parent,
    children: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe("serializeConversation (llama.cpp JSONL)", () => {
  it("emits a session header followed by one message record per line", () => {
    const c = conv([
      msg("u1", null, "user", "hello"),
      msg("a1", "u1", "assistant", "hi there"),
    ]);
    const lines = serializeConversation(c).split("\n");

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({
      harness: "llama.app",
      type: "session",
      id: "conv-1",
      name: "Test conversation",
      lastModified: 20,
      currNode: "a1",
      model: "llama-3.1-8b",
    });
    expect(JSON.parse(lines[1])).toEqual({
      type: "message",
      message: {
        id: "u1",
        convId: "conv-1",
        type: "root",
        timestamp: 1,
        role: "user",
        content: "hello",
        parent: null,
        children: ["a1"],
      },
    });
    expect(JSON.parse(lines[2])).toEqual({
      type: "message",
      message: {
        id: "a1",
        convId: "conv-1",
        type: "text",
        timestamp: 1,
        role: "assistant",
        content: "hi there",
        parent: "u1",
        children: [],
      },
    });
  });

  it("exports the full tree, sibling branches included", () => {
    const c = conv([
      msg("u1", null, "user", "prompt"),
      msg("a1", "u1", "assistant", "first"),
      msg("a2", "u1", "assistant", "second"),
    ]);
    const messages = serializeConversation(c)
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line).message);

    expect(messages).toHaveLength(3);
    const root = messages.find((m) => m.id === "u1");
    expect(root.children.sort()).toEqual(["a1", "a2"]);
  });

  it("drops failed turns", () => {
    const c = conv([
      msg("u1", null, "user", "hi"),
      msg("a1", "u1", "assistant", "", { error: "stopped" }),
    ]);
    const messages = serializeConversation(c)
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line).message);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("u1");
  });

  it("maps reasoning and attachments into llama.cpp fields", () => {
    const c = conv([
      msg("u1", null, "user", "see this", {
        attachments: [
          {
            id: "att-1",
            dataUrl: "data:image/png;base64,AAAA",
            mimeType: "image/png",
            name: "pic.png",
          },
        ],
      }),
      msg("a1", "u1", "assistant", "answer", { reasoning: "thinking hard" }),
    ]);
    const messages = serializeConversation(c)
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line).message);

    expect(messages[0].extra).toEqual([
      {
        type: "IMAGE",
        name: "pic.png",
        mimeType: "image/png",
        base64Url: "data:image/png;base64,AAAA",
      },
    ]);
    expect(messages[1].reasoningContent).toBe("thinking hard");
  });

  it("marks a system-root message with type system", () => {
    const c = conv([msg("s1", null, "system", "be concise")]);
    const message = JSON.parse(serializeConversation(c).split("\n")[1]).message;
    expect(message.type).toBe("system");
  });
});

describe("file naming (llama.cpp scheme)", () => {
  it("builds `<ISO>_conv_<id8>_<name20>.jsonl` from the newest message", () => {
    const c = conv(
      [
        msg("u1", null, "user", "hi", { createdAt: 1_700_000_000_000 }),
        msg("a1", "u1", "assistant", "yo", { createdAt: 1_700_000_100_000 }),
      ],
      "My Big Chat!",
    );
    // 1_700_000_100_000 ms = 2023-11-14T22:15:00Z -> T and : replaced.
    // The trailing `_` from "My Big Chat!" stays, exactly as llama.cpp names it.
    expect(conversationFileName(c)).toBe(
      "2023-11-14_22-15-00_conv_conv-1_my_big_chat_.jsonl",
    );
  });

  it("sanitizes titles to lowercase alphanumerics with single underscores", () => {
    const c = conv(
      [msg("u1", null, "user", "hi")],
      'Plan "Q3" <budget> / final?',
    );
    expect(conversationFileName(c)).toMatch(
      /_conv_conv-1_plan_q3_budget_final\.jsonl$/,
    );
  });

  it("uses now when the conversation has no messages", () => {
    const c = conv([], "");
    const name = conversationFileName(c);
    expect(name).toMatch(
      /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_conv_conv-1_\.jsonl$/,
    );
  });

  it("produces a dated archive name", () => {
    expect(conversationsArchiveFileName()).toMatch(
      /^\d{4}-\d{2}-\d{2}_conversations\.zip$/,
    );
  });
});

describe("exportConversations (single vs archive)", () => {
  it("exports a single conversation as a JSONL file", () => {
    const c = conv([msg("u1", null, "user", "hi")]);
    const result = exportConversations([c]);
    expect(result.mimeType).toBe("application/jsonl");
    expect(result.filename.endsWith(".jsonl")).toBe(true);
    const text = new TextDecoder().decode(result.bytes);
    expect(JSON.parse(text.split("\n")[0]).type).toBe("session");
  });

  it("exports several conversations as a ZIP of JSONL files", () => {
    const a = conv([msg("u1", null, "user", "one")], "Alpha");
    const b = conv([msg("u2", null, "user", "two")], "Beta");
    const result = exportConversations([a, b]);

    expect(result.mimeType).toBe("application/zip");
    expect(result.bytes[0]).toBe(0x50); // "P"
    expect(result.bytes[1]).toBe(0x4b); // "K"

    const entries = unzipSync(result.bytes);
    const names = Object.keys(entries).sort();
    expect(names).toHaveLength(2);
    expect(names.every((n) => n.endsWith(".jsonl"))).toBe(true);

    const sessions = names.map((n) =>
      JSON.parse(new TextDecoder().decode(entries[n]).split("\n")[0]),
    );
    expect(sessions.map((s) => s.name).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("disambiguates duplicate file names inside the archive", () => {
    const a = conv([msg("u1", null, "user", "one")], "Same");
    const b = conv([msg("u2", null, "user", "two")], "Same");
    const entries = unzipSync(exportConversations([a, b]).bytes);
    const names = Object.keys(entries).sort();
    expect(names).toHaveLength(2);
    expect(names.some((n) => /_1\.jsonl$/.test(n))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

describe("parseBackupFile", () => {
  it("round-trips a conversation through its own JSONL export", () => {
    const c = conv([
      msg("u1", null, "user", "hello"),
      msg("a1", "u1", "assistant", "hi there"),
    ]);
    const result = parseBackupFile(
      strToU8(serializeConversation(c)),
      PARSE_OPTS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations).toHaveLength(1);

    const [restored] = result.conversations;
    expect(restored.title).toBe("Test conversation");
    expect(restored.model).toBe("llama-3.1-8b");
    expect(restored.messages.map((m) => m.content)).toEqual([
      "hello",
      "hi there",
    ]);
    expect(restored.messages[0].parentId).toBeNull();
    expect(restored.messages[1].parentId).toBe(restored.messages[0].id);
    expect(restored.leafId).toBe(restored.messages[1].id);
    // Copies get fresh ids, never the file's ids.
    expect(restored.id).not.toBe("conv-1");
  });

  it("restores the active branch from currNode with sibling branches intact", () => {
    // root -> u1 -> a1 -> { u2a -> a2a | u2b -> a2b }, currNode = a2a.
    const text = sessionJsonl(
      { id: "c1", name: "Branched", lastModified: 100, currNode: "a2a" },
      [
        llamaMessage("root", "c1", null, "user", "root"),
        llamaMessage("u1", "c1", "root", "user", "u1"),
        llamaMessage("a1", "c1", "u1", "assistant", "a1"),
        llamaMessage("u2a", "c1", "a1", "user", "u2a"),
        llamaMessage("a2a", "c1", "u2a", "assistant", "a2a"),
        llamaMessage("u2b", "c1", "a1", "user", "u2b"),
        llamaMessage("a2b", "c1", "u2b", "assistant", "a2b"),
      ],
    );
    const result = parseBackupFile(strToU8(text), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [restored] = result.conversations;
    expect(restored.messages).toHaveLength(7);
    const byContent = new Map(restored.messages.map((m) => [m.content, m]));
    expect(restored.leafId).toBe(byContent.get("a2a")!.id);

    // The branch point remembers the active child (u2a, on the leaf path).
    const a1 = byContent.get("a1")!;
    expect(a1.activeChildId).toBe(byContent.get("u2a")!.id);
    expect(byContent.get("u1")!.activeChildId).toBe(a1.id);
  });

  it("imports several sessions from one JSONL file", () => {
    const text = [
      sessionJsonl(
        { id: "a", name: "Chat a", lastModified: 0, currNode: null },
        [llamaMessage("a-m", "a", null, "user", "hello from a")],
      ),
      sessionJsonl(
        { id: "b", name: "Chat b", lastModified: 0, currNode: null },
        [llamaMessage("b-m", "b", null, "user", "hello from b")],
      ),
    ].join("\n");
    const result = parseBackupFile(strToU8(text), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations.map((c) => c.title)).toEqual([
      "Chat a",
      "Chat b",
    ]);
  });

  it("imports a ZIP archive and ignores non-JSONL entries", () => {
    const files: Record<string, Uint8Array> = {
      "a.jsonl": strToU8(
        sessionJsonl(
          { id: "a", name: "Chat a", lastModified: 0, currNode: null },
          [llamaMessage("a-m", "a", null, "user", "hello from a")],
        ),
      ),
      "b.jsonl": strToU8(
        sessionJsonl(
          { id: "b", name: "Chat b", lastModified: 0, currNode: null },
          [llamaMessage("b-m", "b", null, "user", "hello from b")],
        ),
      ),
      "notes.txt": strToU8("ignored"),
    };
    const result = parseBackupFile(zipSync(files), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations.map((c) => c.title).sort()).toEqual([
      "Chat a",
      "Chat b",
    ]);
  });

  it("imports the legacy JSON array of {conv, messages}", () => {
    const json = JSON.stringify([
      {
        conv: { id: "a", name: "Chat a", lastModified: 0 },
        messages: [llamaMessage("m", "a", null, "user", "hi")],
      },
    ]);
    const result = parseBackupFile(strToU8(json), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].title).toBe("Chat a");
  });

  it("imports the legacy single {conv, messages} object", () => {
    const json = JSON.stringify({
      conv: { id: "a", name: "Chat a", lastModified: 0 },
      messages: [llamaMessage("m", "a", null, "user", "hi")],
    });
    const result = parseBackupFile(strToU8(json), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations).toHaveLength(1);
  });

  it("still reads this app's former bundle format", () => {
    const json = JSON.stringify({
      app: "acfb-ai-studio",
      kind: "conversation-backup",
      version: 1,
      conversations: [
        {
          title: "Old chat",
          model: "qwen-2.5",
          createdAt: 111,
          updatedAt: 222,
          messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
          ],
        },
      ],
    });
    const result = parseBackupFile(strToU8(json), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [c] = result.conversations;
    expect(c.title).toBe("Old chat");
    expect(c.titleSource).toBe("user");
    expect(c.model).toBe("qwen-2.5");
    expect(c.createdAt).toBe(111);
    expect(c.updatedAt).toBe(222);
    expect(c.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
  });

  it("imports a bare OpenAI-style message list as a linear conversation", () => {
    const json = JSON.stringify({
      messages: [
        {
          role: "user",
          content: "what is this?",
          images: ["data:image/png;base64,AAAA"],
        },
        { role: "assistant", content: "a cat" },
      ],
    });
    const result = parseBackupFile(strToU8(json), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [c] = result.conversations;
    expect(c.messages).toHaveLength(2);
    expect(c.messages[0].attachments).toHaveLength(1);
    expect(c.messages[0].attachments![0]).toMatchObject({
      dataUrl: "data:image/png;base64,AAAA",
      mimeType: "image/png",
    });
    expect(c.messages[1].parentId).toBe(c.messages[0].id);
  });

  it("maps extra image records to attachments with their mimeType", () => {
    const text = sessionJsonl(
      { id: "a", name: "With image", lastModified: 0, currNode: null },
      [
        {
          ...llamaMessage("m", "a", null, "user", "see", {
            extra: [
              {
                type: "IMAGE",
                name: "pic.png",
                mimeType: "image/jpeg",
                base64Url: "data:image/jpeg;base64,BBBB",
              },
            ],
          }),
        },
      ],
    );
    const result = parseBackupFile(strToU8(text), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations[0].messages[0].attachments![0]).toMatchObject({
      dataUrl: "data:image/jpeg;base64,BBBB",
      mimeType: "image/jpeg",
      name: "pic.png",
    });
  });

  it("keeps an image-only user turn (no text)", () => {
    const json = JSON.stringify({
      messages: [
        { role: "user", content: "", images: ["data:image/png;base64,AAAA"] },
      ],
    });
    const result = parseBackupFile(strToU8(json), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations[0].messages[0].attachments).toHaveLength(1);
    expect(result.conversations[0].title).toBe("Imported conversation");
  });

  it("preserves reasoning and derives title from the first user message", () => {
    const text = sessionJsonl(
      { id: "a", name: "", lastModified: 0, currNode: null },
      [
        llamaMessage("m1", "a", null, "user", "Plan a trip to Tokyo", {
          reasoningContent: "let me think",
        }),
      ],
    );
    const result = parseBackupFile(strToU8(text), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [c] = result.conversations;
    expect(c.title).toContain("Plan a trip to Tokyo");
    expect(c.messages[0].reasoning).toBe("let me think");
  });

  it("drops tool-role messages, keeping the rest of the thread", () => {
    const text = sessionJsonl(
      { id: "a", name: "Tools", lastModified: 0, currNode: null },
      [
        llamaMessage("u1", "a", null, "user", "hi"),
        llamaMessage("asst", "a", "u1", "assistant", "", {
          toolCalls: [{ id: "t1" }],
        }),
        llamaMessage("tool", "a", "asst", "tool", "result"),
        llamaMessage("a2", "a", "asst", "assistant", "final"),
      ],
    );
    const result = parseBackupFile(strToU8(text), PARSE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [c] = result.conversations;
    // The tool result is dropped; the assistant turn (with its toolCalls) and
    // the final answer stay, as exported.
    expect(c.messages.map((m) => m.content)).toEqual(["hi", "", "final"]);
    expect(c.messages[1].parentId).toBe(c.messages[0].id);
    expect(c.messages[2].parentId).toBe(c.messages[1].id);
  });

  it("rejects a zip entry whose message record precedes a session", () => {
    const zipped = zipSync({
      "bad.jsonl": strToU8(
        JSON.stringify({ type: "message", message: { id: "m" } }),
      ),
    });
    const result = parseBackupFile(zipped, PARSE_OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("message record before any session");
  });

  it("reports a clear error on invalid JSON", () => {
    const result = parseBackupFile(strToU8("{not json"), PARSE_OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Not valid JSON");
  });

  it("reports when the file holds no usable conversation", () => {
    const result = parseBackupFile(
      strToU8(JSON.stringify({ foo: "bar" })),
      PARSE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No conversations");
  });

  it("counts sessions with no usable messages as skipped", () => {
    const text = sessionJsonl(
      { id: "a", name: "Empty", lastModified: 0, currNode: null },
      [{ ...llamaMessage("t1", "a", null, "tool", "result") }],
    );
    const result = parseBackupFile(strToU8(text), PARSE_OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No conversations with usable messages");
  });
});
