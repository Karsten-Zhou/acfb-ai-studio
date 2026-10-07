// Shared types for the AI chat application, mirrored between the client and
// the server (`@shared/chat`). Every type is derived from its zod schema so
// `api.ts` and `sync.ts` compose these schemas instead of re-declaring fields.

import z from "zod";

/** Matches the Workers AI definition; `off` disables thinking entirely. */
export const reasoningEffortSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/** Generation knobs adjustable per-request from the UI. */
export const generationParamsSchema = z.object({
  temperature: z.number().optional(),
  topP: z.number().optional(),
  stream: z.boolean().optional(),
});
export type GenerationParams = z.infer<typeof generationParamsSchema>;

/**
 * The wire shape of a chat message — what `/api/chat` accepts. Kept separate
 * from the storage `ChatMessage` so branch metadata never leaks into requests.
 */
export const wireChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  /** Optional chain-of-thought content from reasoning models. */
  reasoning: z.string().optional(),
});
export type WireChatMessage = z.infer<typeof wireChatMessageSchema>;

/**
 * A stored chat message node. Messages form a tree (`parentId`) so a
 * conversation can hold sibling branches (edit / try-again variants).
 */
export const chatMessageSchema = z.object({
  ...wireChatMessageSchema.shape,
  id: z.string().min(1),
  parentId: z.string().nullable(),
  /** Also defines sibling order (oldest first). */
  createdAt: z.number(),
  /** Which child is on the currently-active branch. */
  activeChildId: z.string().optional(),
  /** Set when generating this reply failed or was stopped. Storage-only. */
  error: z.string().optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A full conversation history: a tree of messages plus the active branch. */
export const conversationSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  /** Fallback, AI-generated, or user-owned. */
  titleSource: z.enum(["fallback", "ai", "user"]).optional(),
  model: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Flat list of all message nodes across every branch. */
  messages: z.array(chatMessageSchema),
  /** Leaf of the active branch (thread = path root → leaf). */
  leafId: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;

/** Defaults for new conversations, persisted to localStorage. */
export const defaultsSchema = z.object({
  model: z.string(),
  reasoningEffort: reasoningEffortSchema,
  params: generationParamsSchema,
  /** Default text-to-image model id for the Draw page. */
  drawModel: z.string().optional(),
  /** Whether new conversations ask the model for a title. */
  autoTitle: z.boolean().optional(),
  /** Global system prompt, sent before every chat request. */
  systemPrompt: z.string().optional(),
});
export type DefaultChatOptions = z.infer<typeof defaultsSchema>;

/** Tag objects emitted over the SSE stream. */
export const streamEventSchema = z.object({
  type: z.enum(["delta", "done", "error"]),
  /** For `delta` — the increment of assistant text. */
  delta: z.string().optional(),
  /** For `done` — the fully accumulated message. */
  content: z.string().optional(),
  /** For `error` — a human-readable reason. */
  message: z.string().optional(),
});
export type StreamEvent = z.infer<typeof streamEventSchema>;

/** Namespace the client-side persistence under. */
export const STORAGE_KEY = "conversations:v2";
