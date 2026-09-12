import { Hono } from "hono";
import { chatRequestSchema } from "@shared/api";
import { zValidator } from "@hono/zod-validator";
import {
  FREE_TEXT_GENERATION_MODELS,
  MODELS_GENERATED_AT,
} from "@shared/generated/models";
import { acceptsParam } from "@shared/generated/traits";
import { errorResponse, upstreamError } from "./errors";

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

  // ---------------------------------------------------------------------
  // Build the Cloudflare payload. `known.name` is the identifier used by
  // env.AI.run and by acceptsParam / getInputSchema.
  // ---------------------------------------------------------------------

  const cfParams: Record<string, unknown> = { messages };

  if (
    params.temperature !== undefined &&
    acceptsParam(known.name, "temperature")
  ) {
    cfParams.temperature = params.temperature;
  }
  if (params.topP !== undefined && acceptsParam(known.name, "top_p")) {
    cfParams.top_p = params.topP;
  }

  // `max_completion_tokens`and the legacy `max_tokens` issue
  const contextUsed =
    messages.reduce((acc, msg) => acc + (msg.content?.length ?? 0), 0) +
    Math.ceil(0.01 * (known.contextWindow || 0));
  if (known.contextWindow && contextUsed >= known.contextWindow) {
    return Response.json(
      {
        error: `Context window exceeded: ${contextUsed} tokens used, but model ${known.name} has a context window of ${known.contextWindow}`,
      },
      { status: 400 },
    );
  } else if (acceptsParam(known.name, "max_completion_tokens")) {
    cfParams.max_completion_tokens = Infinity;
  } else if (acceptsParam(known.name, "max_tokens") && known.contextWindow) {
    cfParams.max_tokens = known.contextWindow - contextUsed;
  }

  const effort =
    reasoningEffort && reasoningEffort !== "off" ? reasoningEffort : null;

  if (acceptsParam(known.name, "chat_template_kwargs")) {
    cfParams.chat_template_kwargs = { enable_thinking: effort !== null };
  }
  if (effort !== null && acceptsParam(known.name, "reasoning_effort")) {
    cfParams.reasoning_effort = effort;
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
        content: result.response ?? "",
        reasoning: result.reasoning ?? "",
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
