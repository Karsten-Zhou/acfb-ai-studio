// Helpers for the images the user attaches to a chat message, shared by the
// browser and the Worker (`@shared/attachments`).
//
// Attachments are carried inline as base64 data URLs so they travel through
// localStorage and the single-KV sync payload without a separate blob store.
// Only the small amount of parsing the two sides genuinely share lives here;
// turning an attachment into a model-specific wire shape is the server's job
// (see server/attachments.ts), because only it knows the generated traits.
//
// Only images are supported. Cloudflare exposes no audio- (or video-) input
// capability anywhere — not as a catalogue property, not as a docs badge, and
// `input_audio` in the schemas is shared OpenAI-compatible vocabulary that even
// text-only models list — so offering it would fail at inference with a hard
// error. See scripts/model-input-introspect.ts.

/** Largest single attachment we accept, before base64 expansion. */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

/** Most attachments allowed on one message. */
export const ATTACHMENTS_MAX_PER_MESSAGE = 4;

export interface ParsedDataUrl {
  mimeType: string;
  /** Base64 payload, without the `data:...;base64,` prefix. */
  base64: string;
}

/**
 * Split a base64 data URL into its MIME type and payload. Returns `null` for
 * anything that is not a base64 data URL (e.g. a `blob:` or `http(s)` URL),
 * which the caller should reject rather than forward upstream.
 */
export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = /^data:([^;,]*)(;base64),(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  return { mimeType, base64: match[3] };
}

/** True when a MIME type names an image. */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** The `accept` attribute value for the image file picker. */
export const IMAGE_ACCEPT_ATTRIBUTE = "image/*";
