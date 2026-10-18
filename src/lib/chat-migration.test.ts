import { describe, expect, it } from "vitest";
import {
  migrateChatStorage,
  migrateConversations,
  segmentsFromLegacy,
  type KeyValueStore,
} from "@shared/chat-migration";
import { CHAT_SCHEMA_VERSION, STORAGE_KEY_PREFIX } from "@shared/chat";

describe("segmentsFromLegacy", () => {
  it("returns [] for an empty legacy message", () => {
    expect(segmentsFromLegacy({})).toEqual([]);
  });

  it("puts reasoning before content", () => {
    expect(segmentsFromLegacy({ reasoning: "R", content: "A" })).toEqual([
      { type: "reasoning", text: "R" },
      { type: "content", text: "A" },
    ]);
  });

  it("places a call at its content offset", () => {
    expect(
      segmentsFromLegacy({
        content: "hello world",
        toolCalls: [{ id: "c1", contentOffset: 6 }],
      }),
    ).toEqual([
      { type: "content", text: "hello " },
      { type: "tool", id: "c1" },
      { type: "content", text: "world" },
    ]);
  });

  it("keeps reasoning, then places calls by offset", () => {
    expect(
      segmentsFromLegacy({
        reasoning: "R",
        content: "ab",
        toolCalls: [{ id: "c1", contentOffset: 1 }],
      }),
    ).toEqual([
      { type: "reasoning", text: "R" },
      { type: "content", text: "a" },
      { type: "tool", id: "c1" },
      { type: "content", text: "b" },
    ]);
  });
});

describe("migrateConversations", () => {
  const legacy = [
    {
      id: "c1",
      messages: [{ id: "m1", role: "assistant", content: "a", reasoning: "r" }],
    },
  ];

  it("adds segments when migrating from v2", () => {
    const out = migrateConversations(legacy, 2) as typeof legacy & {
      messages: { segments: unknown }[];
    };
    const conv = (out as unknown as { messages: { segments: unknown }[] }[])[0];
    expect(conv.messages[0].segments).toEqual([
      { type: "reasoning", text: "r" },
      { type: "content", text: "a" },
    ]);
  });

  it("passes data newer than the current version through untouched", () => {
    expect(migrateConversations(legacy, 999)).toBe(legacy);
  });
});

// ---------------------------------------------------------------------------
// migrateChatStorage
// ---------------------------------------------------------------------------

/** In-memory `KeyValueStore`; `failWrites` simulates persistence failing. */
class MemoryStorage implements KeyValueStore {
  private readonly map = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) return;
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const CURRENT_KEY = `${STORAGE_KEY_PREFIX}${CHAT_SCHEMA_VERSION}`;
const LEGACY_KEY = `${STORAGE_KEY_PREFIX}2`;

function legacyConversations() {
  return [
    {
      id: "c1",
      messages: [{ id: "m1", role: "assistant", content: "a", reasoning: "r" }],
    },
  ];
}

describe("migrateChatStorage", () => {
  it("migrates the legacy key forward and removes it", () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_KEY, JSON.stringify(legacyConversations()));

    expect(migrateChatStorage(s)).toEqual({ migrated: true, fromVersion: 2 });
    expect(s.getItem(LEGACY_KEY)).toBeNull();
    expect(JSON.parse(s.getItem(CURRENT_KEY)!)[0].messages[0].segments).toEqual(
      [
        { type: "reasoning", text: "r" },
        { type: "content", text: "a" },
      ],
    );
  });

  it("migrates even when an empty current key already exists", () => {
    // Regression: skipping migration because the current key existed, yet still
    // deleting the legacy key, is exactly what destroyed user data.
    const s = new MemoryStorage();
    s.setItem(CURRENT_KEY, "[]");
    s.setItem(LEGACY_KEY, JSON.stringify(legacyConversations()));

    expect(migrateChatStorage(s).migrated).toBe(true);
    expect(JSON.parse(s.getItem(CURRENT_KEY)!)).toHaveLength(1);
    expect(s.getItem(LEGACY_KEY)).toBeNull();
  });

  it("never clobbers non-empty current data", () => {
    const s = new MemoryStorage();
    s.setItem(CURRENT_KEY, JSON.stringify([{ id: "keep" }]));
    s.setItem(LEGACY_KEY, JSON.stringify(legacyConversations()));

    expect(migrateChatStorage(s).migrated).toBe(false);
    expect(JSON.parse(s.getItem(CURRENT_KEY)!)).toEqual([{ id: "keep" }]);
    expect(s.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("leaves unparseable legacy data untouched", () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_KEY, "{not json");

    expect(migrateChatStorage(s).migrated).toBe(false);
    expect(s.getItem(CURRENT_KEY)).toBeNull();
    expect(s.getItem(LEGACY_KEY)).toBe("{not json");
  });

  it("is a no-op when there is no older key", () => {
    expect(migrateChatStorage(new MemoryStorage())).toEqual({
      migrated: false,
    });
  });

  it("keeps the source when the write does not persist", () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_KEY, JSON.stringify(legacyConversations()));
    s.failWrites = true;

    expect(migrateChatStorage(s).migrated).toBe(false);
    expect(s.getItem(LEGACY_KEY)).not.toBeNull();
  });
});
