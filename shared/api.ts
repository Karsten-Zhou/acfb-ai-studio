import z from "zod";
import type { ReasoningEffort, WireChatMessage } from "@shared/chat";

export const chatRequestSchema = z.object({
  conversationId: z.uuid().optional(),
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        reasoning: z.string().optional(),
      }),
    )
    .min(1),
  params: z
    .object({
      temperature: z.number().min(0),
      topP: z.number().min(0).max(1),
      stream: z.boolean(),
    })
    .partial(),
  reasoningEffort: z
    .enum(["off", "minimal", "low", "medium", "high"])
    .optional(),
});

// Ensure the wire schema stays shape-compatible with the shared wire type.
// This asserts against `WireChatMessage` — NOT the storage `ChatMessage`:
// branch metadata (id/parentId/createdAt) must never go on the wire.
export type ChatRequest = z.infer<typeof chatRequestSchema> & {
  messages: WireChatMessage[];
  reasoningEffort?: ReasoningEffort;
};

/**
 * Payload for the text-to-image endpoint (`POST /api/draw`). Kept modest: the
 * server fills in family-specific defaults and maps to the model's input keys,
 * so the client stays transport-agnostic.
 *
 * `width`/`height` are optional because Cloudflare never marks them required —
 * a model may not accept them at all (FLUX), or may accept them and apply its
 * own default when omitted. Their bounds here are only a coarse payload guard;
 * the authoritative per-model bounds are applied by `clamp` on the server.
 */
export const imageRequestSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  width: z.number().int().nonnegative().max(4096).optional(),
  height: z.number().int().nonnegative().max(4096).optional(),
  numSteps: z.number().int().min(1).max(50).optional(),
  guidance: z.number().min(0).max(30).optional(),
  seed: z.number().int().optional(),
});

export type ImageRequest = z.infer<typeof imageRequestSchema>;

/** Normalized image result returned by the server. */
export interface ImageResult {
  /** Data URL (e.g. `data:image/png;base64,...`) ready for an `<img>` src. */
  image: string;
  model: string;
  /** Actual output size, sniffed from the image header. Omitted if unreadable. */
  width?: number;
  height?: number;
  /** Echoed back seed so the user can reproduce a result. */
  seed?: number;
}
