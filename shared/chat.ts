// Shared types for the AI chat application, mirrored between the client and
// the server (`@shared/chat`). Every type is derived from its zod schema so
// `api.ts` and `sync.ts` compose these schemas instead of re-declaring fields.

import z from "zod";

/**
 * Canonical reasoning-depth scale, ordered lowest → highest.
 *
 * This is the app's vocabulary, not any single model's. Cloudflare declares a
 * model-specific subset as an enum (`low/medium/xhigh`, `max/high/low`, ...),
 * so the levels offered for a model come from its schema
 * (`getReasoningOptions`), and a stored value is snapped to the nearest offered
 * level (`normalizeReasoningEffort`).
 *
 * `none` means "do not reason". It is a real member of the scale, not a
 * separate flag, so a single code path maps any level onto the model's wire
 * params: `none` drives a chat-template toggle off and/or a
 * `reasoning_effort: "none"`, whichever the model declares.
 */
const REASONING_EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const reasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/** The scale as a plain array, for ordinal comparisons. */
export const REASONING_EFFORTS: readonly ReasoningEffort[] =
  REASONING_EFFORT_VALUES;

/** Generation knobs adjustable per-request from the UI. */
export const generationParamsSchema = z.object({
  temperature: z.number().optional(),
  topP: z.number().optional(),
  stream: z.boolean().optional(),
});
export type GenerationParams = z.infer<typeof generationParamsSchema>;

/**
 * An image the user attached to a message. Held inline as a base64 data URL so
 * it survives localStorage and sync unchanged; `mimeType` is stored alongside
 * for display and validation.
 */
export const attachmentSchema = z.object({
  id: z.string().min(1),
  /** e.g. `data:image/png;base64,...`. */
  dataUrl: z.string().min(1),
  mimeType: z.string().min(1),
  /** Original file name, for display only. */
  name: z.string().optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/**
 * The wire shape of a chat message — what `/api/chat` accepts. Kept separate
 * from the storage `ChatMessage` so branch metadata never leaks into requests.
 *
 * `attachments` is only meaningful for `user` messages; the server rejects it
 * elsewhere (Cloudflare only defines media content parts on the user role).
 */
export const wireChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  /** Optional chain-of-thought content from reasoning models. */
  reasoning: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
});
export type WireChatMessage = z.infer<typeof wireChatMessageSchema>;

/**
 * One tool invocation the model requested, and — once the server has run it —
 * the result. Stored on the assistant message purely so the UI can render the
 * tool-calling steps; it is never sent back to the model as history.
 */
export const toolCallSchema = z.object({
  /** Provider-assigned id, used to pair a call with its result. */
  id: z.string().min(1),
  /** Tool name, e.g. `get_current_datetime`. */
  name: z.string().min(1),
  /** Raw JSON argument string exactly as the model emitted it. */
  arguments: z.string(),
  /** Serialized tool result, once available. */
  result: z.string().optional(),
  /** Set when execution failed; `result` may then hold a diagnostic. */
  error: z.string().optional(),
  /**
   * Length of the reply's content when this call was requested, so the UI can
   * render it inline where it happened. Storage-only; absent means "at the top".
   */
  contentOffset: z.number().int().nonnegative().optional(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

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
  /** Tool-calling steps taken while producing this reply. Storage-only. */
  toolCalls: z.array(toolCallSchema).optional(),
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
  /** Tool ids enabled for tool-calling models. */
  tools: z.array(z.string()).optional(),
});
export type DefaultChatOptions = z.infer<typeof defaultsSchema>;

/** SSE events, discriminated on `type`. */
export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("delta"),
    delta: z.string().optional(),
    reasoning: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_call"),
    id: z.string(),
    name: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string(),
    name: z.string(),
    result: z.string(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("done"),
    content: z.string().optional(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

/** Namespace the client-side persistence under. */
export const STORAGE_KEY = "conversations:v2";
