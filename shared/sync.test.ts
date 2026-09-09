import { describe, expect, it } from "vitest";
import {
  SYNC_VERSION,
  encodeSyncPush,
  mergePayloads,
  parseSyncPayload,
  parseSyncPushRequest,
  type SyncPayload,
} from "@shared/sync";
import type { Conversation } from "@shared/chat";
import type { GalleryItem } from "@shared/draw";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function conversation(overrides: Partial<Conversation> & { id: string }) {
  return {
    title: "title",
    model: "model",
    createdAt: 0,
    updatedAt: 0,
    messages: [],
    leafId: null, // <-- Added to match the new Conversation interface
    ...overrides,
  } satisfies Conversation;
}

function image(overrides: Partial<GalleryItem> & { id: string }) {
  return {
    prompt: "prompt",
    model: "model",
    width: 512,
    height: 512,
    image: "data:image/png;base64,AAAA",
    createdAt: 0,
    ...overrides,
  } satisfies GalleryItem;
}

function payload(overrides: Partial<SyncPayload> = {}): SyncPayload {
  return {
    version: SYNC_VERSION,
    revision: 0,
    updatedAt: 0,
    conversations: [],
    gallery: [],
    defaults: { model: "model", reasoningEffort: "medium", params: {} },
    defaultsUpdatedAt: 0,
    deletions: {},
    ...overrides,
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

// ---------------------------------------------------------------------------
// mergePayloads
// ---------------------------------------------------------------------------

describe("mergePayloads", () => {
  it("keeps items only one side has, and asks both sides to move", () => {
    const result = mergePayloads(
      payload({ conversations: [conversation({ id: "a", updatedAt: 1 })] }),
      payload({ conversations: [conversation({ id: "b", updatedAt: 2 })] }),
    );

    expect(ids(result.payload.conversations)).toEqual(["b", "a"]);
    expect(result.changedLocal).toBe(true);
    expect(result.changedRemote).toBe(true);
  });

  it("keeps the newest revision of a conversation", () => {
    const result = mergePayloads(
      payload({
        conversations: [conversation({ id: "a", updatedAt: 5, title: "old" })],
      }),
      payload({
        conversations: [conversation({ id: "a", updatedAt: 9, title: "new" })],
      }),
    );

    expect(result.payload.conversations[0].title).toBe("new");
    expect(result.changedLocal).toBe(true);
    expect(result.changedRemote).toBe(false);
  });

  it("reports no change at all when both sides already agree", () => {
    const result = mergePayloads(
      payload({ conversations: [conversation({ id: "a", updatedAt: 5 })] }),
      payload({ conversations: [conversation({ id: "a", updatedAt: 5 })] }),
    );

    expect(result.changedLocal).toBe(false);
    expect(result.changedRemote).toBe(false);
  });

  it("drops items covered by a tombstone so deletes are not resurrected", () => {
    const result = mergePayloads(
      payload({ deletions: { a: 10 } }),
      payload({ conversations: [conversation({ id: "a", updatedAt: 5 })] }),
    );

    expect(result.payload.conversations).toHaveLength(0);
    expect(result.payload.deletions).toEqual({ a: 10 });
    // The other device still has to learn about the deletion.
    expect(result.changedRemote).toBe(true);
  });

  it("keeps an item that was edited after it was deleted elsewhere", () => {
    const result = mergePayloads(
      payload({ conversations: [conversation({ id: "a", updatedAt: 20 })] }),
      payload({ deletions: { a: 10 } }),
    );

    expect(ids(result.payload.conversations)).toEqual(["a"]);
    expect(result.changedRemote).toBe(true);
  });

  it("merges gallery items by creation time", () => {
    const result = mergePayloads(
      payload({ gallery: [image({ id: "x", createdAt: 1 })] }),
      payload({
        gallery: [
          image({ id: "x", createdAt: 1, prompt: "same" }),
          image({ id: "y", createdAt: 2 }),
        ],
      }),
    );

    expect(ids(result.payload.gallery)).toEqual(["y", "x"]);
    expect(result.changedLocal).toBe(true);
    expect(result.changedRemote).toBe(false);
  });

  it("resolves defaults by their own timestamp", () => {
    const result = mergePayloads(
      payload({
        defaults: { model: "local", reasoningEffort: "low", params: {} },
        defaultsUpdatedAt: 5,
      }),
      payload({
        defaults: { model: "remote", reasoningEffort: "high", params: {} },
        defaultsUpdatedAt: 9,
      }),
    );

    expect(result.payload.defaults.model).toBe("remote");
    expect(result.changedLocal).toBe(true);
    expect(result.changedRemote).toBe(false);
  });

  it("ignores equal defaults even when the objects differ by identity", () => {
    const defaults = { model: "m", reasoningEffort: "medium" as const, params: {} };
    const result = mergePayloads(
      payload({ defaults: { ...defaults, params: {} } }),
      payload({ defaults: { ...defaults, params: {} } }),
    );

    expect(result.changedLocal).toBe(false);
    expect(result.changedRemote).toBe(false);
  });

  it("takes the highest revision so later syncs compare against the winner", () => {
    const result = mergePayloads(
      payload({ revision: 3 }),
      payload({ revision: 11 }),
    );

    expect(result.payload.revision).toBe(11);
  });

  it("orders items identically no matter which side they came from", () => {
    const a = conversation({ id: "a", updatedAt: 7 });
    const b = conversation({ id: "b", updatedAt: 7 });

    const forward = mergePayloads(
      payload({ conversations: [a] }),
      payload({ conversations: [b] }),
    );
    const backward = mergePayloads(
      payload({ conversations: [b] }),
      payload({ conversations: [a] }),
    );

    expect(ids(forward.payload.conversations)).toEqual(
      ids(backward.payload.conversations),
    );
  });
});

// ---------------------------------------------------------------------------
// PUT /api/sync wire format
// ---------------------------------------------------------------------------

describe("push request envelope", () => {
  it("round-trips what the client sends", () => {
    const parsed = parseSyncPushRequest(
      JSON.parse(encodeSyncPush({ baseRevision: 3, payload: payload() })),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.request.baseRevision).toBe(3);
  });

  it("rejects the bare payload sent without its envelope", () => {
    // Regression: the client once POSTed the payload on its own, so *every*
    // write was rejected as an invalid request body.
    const parsed = parseSyncPushRequest(payload());

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toMatch(/baseRevision/);
  });

  it("names the offending field when the envelope is malformed", () => {
    const parsed = parseSyncPushRequest({ baseRevision: -1, payload: {} });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toMatch(/baseRevision/);
  });

  it("names the offending field when the payload is malformed", () => {
    const parsed = parseSyncPushRequest({
      baseRevision: 0,
      payload: { ...payload(), deletions: "nope" },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toMatch(/deletions/);
  });
});

// ---------------------------------------------------------------------------
// parseSyncPayload
// ---------------------------------------------------------------------------

describe("parseSyncPayload", () => {
  it("accepts a well-formed payload", () => {
    const parsed = parseSyncPayload(payload());
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(SYNC_VERSION);
  });

  it("accepts gallery items with no known size", () => {
    // Some models report no output size, so width/height are optional.
    const parsed = parseSyncPayload({
      ...payload(),
      gallery: [
        { id: "x", prompt: "p", model: "m", image: "data:", createdAt: 1 },
      ],
    });

    expect(parsed?.gallery[0].width).toBeUndefined();
    expect(parsed?.gallery[0].height).toBeUndefined();
  });

  it("rejects values that are missing required fields", () => {
    expect(parseSyncPayload(null)).toBeNull();
    expect(parseSyncPayload({})).toBeNull();
    expect(parseSyncPayload({ ...payload(), conversations: "nope" })).toBeNull();
    expect(parseSyncPayload({ ...payload(), deletions: [1, 2] })).toBeNull();
  });

  it("rejects a conversation without an id", () => {
    expect(
      parseSyncPayload({
        ...payload(),
        conversations: [{ ...conversation({ id: "a" }), id: "" }],
      }),
    ).toBeNull();
  });

  it("preserves unknown fields rather than stripping them", () => {
    const parsed = parseSyncPayload({
      ...payload(),
      futureField: "keep me",
    });
    expect((parsed as unknown as Record<string, unknown>).futureField).toBe(
      "keep me",
    );
  });
});
