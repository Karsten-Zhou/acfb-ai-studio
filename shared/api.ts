import z from "zod";
import {
  reasoningEffortSchema,
  toolCallSchema,
  wireChatMessageSchema,
} from "./chat";

export const chatRequestSchema = z.object({
  conversationId: z.uuid().optional(),
  model: z.string().min(1),
  messages: z.array(wireChatMessageSchema).min(1),
  params: z
    .object({
      temperature: z.number().min(0),
      topP: z.number().min(0).max(1),
      stream: z.boolean(),
    })
    .partial(),
  reasoningEffort: reasoningEffortSchema.optional(),
  /** Tool ids the user enabled for this request. Empty/absent means none. */
  tools: z.array(z.string()).optional(),
});

/** The wire chat request, derived from the schema. */
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Non-streaming response of `POST /api/chat`. Streaming is delivered via SSE. */
export const chatResponseSchema = z.object({
  conversationId: z.uuid().optional(),
  content: z.string(),
  reasoning: z.string(),
  model: z.string().min(1),
  /** Tool-calling steps taken while producing the answer. */
  toolCalls: z.array(toolCallSchema).optional(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

/** Request/response of `POST /api/chat/title`. */
export const titleRequestSchema = z.object({
  model: z.string().min(1),
  subject: z.string().min(1),
});
export type TitleRequest = z.infer<typeof titleRequestSchema>;

export const titleResponseSchema = z.object({ title: z.string().min(1) });
export type TitleResponse = z.infer<typeof titleResponseSchema>;

/**
 * Payload for the text-to-image endpoint (`POST /api/draw`). `width`/`height`
 * are optional because Cloudflare never marks them required — a model may not
 * accept them at all (FLUX), or may apply its own default when omitted. The
 * authoritative per-model bounds are applied by `clamp` on the server.
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
export const imageResultSchema = z.object({
  /** Data URL (e.g. `data:image/png;base64,...`) ready for an `<img>` src. */
  image: z.string().min(1),
  model: z.string().min(1),
  /** Actual output size, sniffed from the image header. Omitted if unreadable. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** Echoed back seed so the user can reproduce a result. */
  seed: z.number().int().optional(),
});
export type ImageResult = z.infer<typeof imageResultSchema>;

/** Generic `{ ok: true }` body. */
export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;
