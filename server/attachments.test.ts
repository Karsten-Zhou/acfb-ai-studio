import { describe, expect, it } from "vitest";
import { buildChatInput } from "./attachments";
import type { Attachment, WireChatMessage } from "@shared/chat";
import type { ModelInfo } from "@shared/generated/models";

/** Minimal ModelInfo with the fields buildChatInput reads. */
function model(name: string): ModelInfo {
  return {
    id: "id",
    name,
    urlPath: "p",
    provider: "p",
    task: "text-generation",
    description: "",
    capabilities: {
      streaming: true,
      functionCalling: false,
      reasoning: false,
      vision: true,
      lora: false,
      beta: false,
      partner: false,
      asyncQueue: false,
      realtime: false,
      requireWorkersPaid: false,
    },
    contextWindow: null,
    pricing: null,
    terms: null,
    createdAt: "",
  };
}

const MESSAGES_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const LEGACY_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const TEXT_ONLY = "@cf/meta/llama-3.2-1b-instruct";

const png: Attachment = {
  id: "a1",
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  mimeType: "image/png",
  name: "x.png",
};

function user(content: string, attachments?: Attachment[]): WireChatMessage {
  return { role: "user", content, ...(attachments ? { attachments } : {}) };
}

describe("buildChatInput", () => {
  it("passes plain messages through unchanged", () => {
    const built = buildChatInput(model(MESSAGES_MODEL), [
      user("hello"),
      { role: "assistant", content: "hi" },
    ]);
    expect(built.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    expect(built.extraParams).toEqual({});
  });

  it("expands an image into an image_url content part on messages models", () => {
    const built = buildChatInput(model(MESSAGES_MODEL), [user("see", [png])]);
    expect(built.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "see" },
          { type: "image_url", image_url: { url: png.dataUrl } },
        ],
      },
    ]);
  });

  it("uses the legacy top-level image param for prompt-input vision models", () => {
    const built = buildChatInput(model(LEGACY_MODEL), [user("see", [png])]);
    // The image is hoisted to a payload-level param, not a content part.
    expect(built.messages).toEqual([{ role: "user", content: "see" }]);
    expect(Array.isArray(built.extraParams.image)).toBe(true);
    expect((built.extraParams.image as number[]).length).toBeGreaterThan(0);
  });

  it("rejects an image the model cannot take", () => {
    expect(() => buildChatInput(model(TEXT_ONLY), [user("x", [png])])).toThrow(
      /does not accept images/,
    );
  });

  it("does not attach media to non-user roles", () => {
    const built = buildChatInput(model(MESSAGES_MODEL), [
      { role: "system", content: "be nice", attachments: [png] },
    ]);
    expect(built.messages).toEqual([{ role: "system", content: "be nice" }]);
  });
});
