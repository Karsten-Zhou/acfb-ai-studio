// Turns the client's inline image attachments into the exact request shape each
// model documents.
//
// Workers AI publishes a JSON Schema per model, and
// scripts/sync-cloudflare-models.ts freezes the image-relevant part of it into
// traits.json. Nothing here hard-codes which models take images: the decision
// reads the generated `image` trait, so a model that starts accepting images
// upstream is supported the moment the catalogue is re-synced.
//
// Two documented shapes exist:
//
//   1. Messages + content parts (all current multimodal chat models):
//        messages[].content = [
//          { type: "text",      text: "..." },
//          { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
//        ]
//
//   2. Legacy top-level media params (prompt-input models such as
//      Llama 3.2 11B Vision): the message stays a plain string and the image
//      rides as a sibling `image` field holding the raw bytes. Cloudflare marks
//      this "Deprecated, use image as a part of messages now", so it is only
//      used for a model whose schema does not document content parts.
//
// Audio and video are intentionally unsupported (see shared/attachments.ts):
// Cloudflare exposes no such capability, so sending them would only fail
// upstream. An attachment is therefore always an image.
//
// Attachment parts are only attached to `user` messages: Cloudflare's schema
// defines media content parts on the user role alone.

import { parseDataUrl } from "@shared/attachments";
import type { Attachment, WireChatMessage } from "@shared/chat";
import type { ModelInfo } from "@shared/generated/models";
import { getInputTraits } from "@shared/generated/traits";
import { UserFacingError } from "./errors";

/** A single OpenAI-style content part. */
type ContentPart = Record<string, unknown> & { type: string };

export interface BuiltChatInput {
  /** The `messages` array to send to Workers AI. */
  messages: unknown[];
  /**
   * Extra top-level params merged into the request. Currently only the legacy
   * `image` field, used by prompt-input vision models.
   */
  extraParams: Record<string, unknown>;
}

/**
 * Encode the wire messages for a model, expanding any image attachments into
 * the content parts (or legacy media params) that model documents. Throws a
 * `UserFacingError` when the model cannot accept an attachment, so the user
 * gets an actionable message instead of an upstream 5006.
 */
export function buildChatInput(
  model: ModelInfo,
  wireMessages: readonly WireChatMessage[],
): BuiltChatInput {
  const input = getInputTraits(model.name);
  // Only models that document typed content parts can carry media inline;
  // every other model keeps the plain-string message shape.
  const usesContentParts = input.messages;
  const messages: unknown[] = [];
  // Legacy media params are payload-level, so they accumulate across messages.
  const legacyImages: number[][] = [];

  for (const message of wireMessages) {
    const attachments = message.attachments ?? [];
    if (attachments.length === 0 || message.role !== "user") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }

    if (!input.image) {
      throw new UserFacingError(`${model.name} does not accept images.`);
    }

    const parts: ContentPart[] = [];
    if (usesContentParts && message.content) {
      parts.push({ type: "text", text: message.content });
    }

    for (const attachment of attachments) {
      const part = encodeImage(model.name, input, attachment, legacyImages);
      if (part) parts.push(part);
    }

    // A model with only the legacy media param (no content parts) keeps its
    // string content; the media rides in `extraParams` instead.
    messages.push({
      role: message.role,
      content: parts.length > 0 ? parts : message.content,
    });
  }

  const extraParams: Record<string, unknown> = {};
  if (legacyImages.length > 0) {
    // The documented legacy shape is an array of 8-bit integers (or a binary
    // string, which has no JSON representation); a single image is passed
    // unwrapped, several as an array, matching Cloudflare's examples.
    extraParams.image =
      legacyImages.length === 1 ? legacyImages[0] : legacyImages;
  }

  return { messages, extraParams };
}

function encodeImage(
  modelName: string,
  input: ReturnType<typeof getInputTraits>,
  attachment: Attachment,
  legacyImages: number[][],
): ContentPart | null {
  const parsed = parseDataUrl(attachment.dataUrl);
  if (!parsed) {
    throw new UserFacingError(
      `Attachment "${attachment.name ?? attachment.id}" is not a base64 data URL.`,
    );
  }

  // Messages models carry the image inline as a content part; prompt-input
  // models take the raw bytes in a payload-level `image` param instead.
  if (input.messages) {
    return {
      type: "image_url",
      image_url: { url: attachment.dataUrl },
    };
  }

  legacyImages.push(base64ToBytes(parsed.base64));
  return null;
}

/** Decode a base64 payload into the 8-bit integer array legacy schemas expect. */
function base64ToBytes(base64: string): number[] {
  const binary = atob(base64);
  const bytes = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
