import { Hono } from "hono";
import { chatRequestSchema } from "@shared/api";
import { zValidator } from "@hono/zod-validator";
import {
  FREE_TEXT_GENERATION_MODELS,
  MODELS_GENERATED_AT,
} from "@shared/generated/models";
import { acceptsParam, getReasoningTraits } from "@shared/generated/traits";
import { reasoningParams } from "@shared/reasoning";
import { errorResponse, upstreamError } from "./errors";
import { readInferenceResult } from "./inference";
import { buildChatInput } from "./attachments";
import { readSyncMeta } from "./sync-storage";
import { SYNC_SOFT_LIMIT_BYTES, softLimitMessage } from "@shared/sync";

const app = new Hono<{ Bindings: Env }>();

app.post("/", zValidator("json", chatRequestSchema), async ({ env, req }) => {
  const body = req.valid("json");
  const { messages, model, reasoningEffort } = body;
  const params = body.params ?? {};
  const conversationId = body.conversationId;

  // Look up the model in the generated catalogue. The client sends the
  // canonical name (`@cf/...`), which is the key into FREE_MODEL_BY_NAME.
  const known = model
    ? FREE_TEXT_GENERATION_MODELS.find((m) => m.name === model)
    : undefined;
  if (!known) {
    return Response.json(
      { error: `Unknown model: ${model ?? "(none provided)"}` },
      { status: 400 },
    );
  }

  const stream = params.stream ?? true;

  // Attachments are stored inline (base64 data URLs) in the conversation tree,
  // which lives in the single-KV sync payload. Sending more would only push it
  // closer to Cloudflare's 25 MiB hard limit, so the same soft-limit gate the
  // Draw page uses applies here. Read only when there is something to send.
  const hasAttachments = messages.some((m) => (m.attachments?.length ?? 0) > 0);
  if (hasAttachments) {
    try {
      const { bytes } = await readSyncMeta(env);
      if (bytes >= SYNC_SOFT_LIMIT_BYTES) {
        return Response.json(
          { error: softLimitMessage(bytes) },
          { status: 413 },
        );
      }
    } catch (err) {
      // Fail open: a storage hiccup must not block chatting.
      console.error("Chat: could not read the sync size:", err);
    }
  }

  // ---------------------------------------------------------------------
  // Build the Cloudflare payload. `known.name` is the identifier used by
  // env.AI.run and by acceptsParam / getInputSchema.
  //
  // Attachments are expanded into the content shape this model documents
  // (see server/attachments.ts), which may also contribute top-level params
  // such as the legacy `image` field.
  // ---------------------------------------------------------------------

  let cfMessages: unknown[];
  let attachmentParams: Record<string, unknown>;
  try {
    const built = buildChatInput(known, messages);
    cfMessages = built.messages;
    attachmentParams = built.extraParams;
  } catch (err) {
    // An attachment the model cannot take is the user's to fix, not a 502.
    return errorResponse(err);
  }

  const cfParams: Record<string, unknown> = {
    messages: cfMessages,
    ...attachmentParams,
  };

  if (
    params.temperature !== undefined &&
    acceptsParam(known.name, "temperature")
  ) {
    cfParams.temperature = params.temperature;
  }
  if (params.topP !== undefined && acceptsParam(known.name, "top_p")) {
    cfParams.top_p = params.topP;
  }

  // Let Workers AI size the output itself. Models with a separate completion
  // budget get an unbounded request (Infinity) so they can use the whole
  // window; the legacy `max_tokens` models get whatever the shallow estimate
  // leaves.
  const contextUsed =
    messages.reduce((acc, msg) => acc + (msg.content?.length ?? 0), 0) +
    Math.ceil(0.01 * (known.contextWindow || 0));
  if (acceptsParam(known.name, "max_completion_tokens")) {
    cfParams.max_completion_tokens = Infinity;
  } else if (acceptsParam(known.name, "max_tokens") && known.contextWindow) {
    cfParams.max_tokens = known.contextWindow - contextUsed;
  }
  // Reasoning: map the canonical level onto whatever the model declares — a
  // graded `reasoning_effort` enum and/or a chat-template toggle. See
  // shared/reasoning.ts. Always sent (even `none`) so a model whose default is
  // "reasoning on" is actually turned off when the user asks.
  // Reasoning: map the canonical level onto whatever the model declares — a
  // graded `reasoning_effort` enum and/or a chat-template toggle. See
  // shared/reasoning.ts. Sent only when the client chose a level; otherwise
  // Cloudflare applies the model's own default.
  if (reasoningEffort !== undefined) {
    Object.assign(
      cfParams,
      reasoningParams(getReasoningTraits(known.name), reasoningEffort),
    );
  }

  if (stream) {
    cfParams.stream = true;
    if (acceptsParam(known.name, "stream_options")) {
      cfParams.stream_options = { include_usage: true };
    }
  }

  console.debug(`cfParams for ${known.name}:`, cfParams);

  // ---------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------

  if (!stream) {
    try {
      const result = await env.AI.run(known.name, cfParams);
      return Response.json({
        conversationId,
        ...readInferenceResult(result),
        model: known.name,
      });
    } catch (err) {
      return errorResponse(upstreamError(err));
    }
  }

  let result: ReadableStream;
  try {
    result = (await env.AI.run(
      known.name,
      cfParams,
    )) as unknown as ReadableStream;
  } catch (err) {
    return errorResponse(upstreamError(err));
  }

  return new Response(result, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
});

// Serve the text-generation subset of the generated catalogue. `generatedAt`
// lets the frontend know how stale its copy might be.
app.get("/models", (c) =>
  c.json({
    models: FREE_TEXT_GENERATION_MODELS,
    generatedAt: MODELS_GENERATED_AT,
  }),
);

export default app;
