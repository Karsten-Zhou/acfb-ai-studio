/**
 * Workers AI answers text generation in one of two shapes, and which one you
 * get depends on the model rather than on the request:
 *
 *   - legacy `prompt`-input models return a top-level `response`;
 *   - chat models return an OpenAI-style `choices[0].message`.
 *
 * Reading only `response` therefore yields an empty answer for every chat
 * model, so both shapes are normalised here before they reach the API contract.
 * The shapes themselves come from the generated Worker types — only what those
 * types do not spell out is declared below.
 */

/**
 * The chat message plus the reasoning text that rides along with it. The
 * generated `ChatCompletionResponseMessage` mirrors OpenAI and so covers only
 * the final answer, while Workers AI also returns the reasoning pass.
 */
type ChatMessage = ChatCompletionsOutput["choices"][number]["message"] & {
  /** Spelling used by the current serving stack. */
  reasoning?: string | null;
  /** Spelling used by the OpenAI-compatible models. */
  reasoning_content?: string | null;
};

/** Either an `AiTextGenerationOutput`, or a chat completion, plus reasoning. */
type TextGenerationResult = AiTextGenerationOutput & {
  choices?: Array<{ message?: ChatMessage }> | null;
  reasoning?: string | null;
};

/** Normalised tool call, independent of which upstream spelling produced it. */
export interface WireToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments string. */
  arguments: string;
}

/**
 * Read the answer (and any reasoning) out of an inference result, falling back
 * to empty strings when the payload carries neither.
 */
export function readInferenceResult(result: unknown): {
  content: string;
  reasoning: string;
} {
  // A few models are typed as answering with a bare string.
  if (typeof result === "string") return { content: result, reasoning: "" };

  const res = (result ?? {}) as TextGenerationResult;
  const message = res.choices?.[0]?.message;

  return {
    content: res.response || message?.content || "",
    reasoning:
      res.reasoning || message?.reasoning || message?.reasoning_content || "",
  };
}

/**
 * Read the tool calls out of a non-streaming inference result.
 *
 * Chat models return OpenAI-style `choices[0].message.tool_calls`; the legacy
 * prompt-input models return a flatter `tool_calls` of `{ name, arguments }`
 * where `arguments` is already an object rather than a JSON string.
 */
export function readToolCalls(result: unknown): WireToolCall[] {
  if (!result || typeof result !== "object") return [];
  const res = result as TextGenerationResult;

  const chatCalls = res.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(chatCalls) && chatCalls.length > 0) {
    return chatCalls.map((call, index) => ({
      id: call.id || `call_${index}`,
      name: call.type === "custom" ? call.custom.name : call.function.name,
      arguments:
        call.type === "custom"
          ? call.custom.input
          : call.function.arguments || "{}",
    }));
  }

  // Legacy `AiTextGenerationOutput.tool_calls` shape.
  const legacy = res.tool_calls;
  if (Array.isArray(legacy) && legacy.length > 0) {
    return legacy.map((call, index) => ({
      id: `call_${index}`,
      name: typeof call.name === "string" ? call.name : "",
      arguments:
        typeof call.arguments === "string"
          ? call.arguments
          : JSON.stringify(call.arguments ?? {}),
    }));
  }

  return [];
}

/** Streaming delta under either spelling Workers AI uses. */
type StreamDelta = {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<StreamToolCallDelta> | null;
};

/** One streamed tool-call fragment. `index` groups fragments of one call. */
type StreamToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string } | null;
  /** Legacy flat spelling used by some prompt-input models. */
  name?: string;
  arguments?: string | Record<string, unknown> | null;
};

/** Shape of one SSE chunk from the upstream inference stream. */
type TextGenerationStreamChunk = {
  // Prompt-input models stream the running answer under `response`.
  response?: string | null;
  choices?: Array<{ delta?: StreamDelta | null }> | null;
  tool_calls?: Array<StreamToolCallDelta> | null;
};

/** Read the text/reasoning increments out of one upstream SSE chunk. */
export function readStreamChunk(chunk: unknown): {
  content?: string;
  reasoning?: string;
} {
  if (typeof chunk === "string") return { content: chunk };
  if (!chunk || typeof chunk !== "object") return {};

  const res = chunk as TextGenerationStreamChunk;
  const delta = res.choices?.[0]?.delta;

  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof res.response === "string"
        ? res.response
        : undefined;
  const reasoning =
    typeof delta?.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta?.reasoning === "string"
        ? delta.reasoning
        : undefined;

  return { content, reasoning };
}

/**
 * Accumulate the tool-call fragments of one upstream stream chunk into `acc`,
 * which is keyed by the fragment `index` (falling back to order of arrival).
 * The `arguments` of a single call typically arrive in several pieces, so they
 * are concatenated rather than replaced.
 */
export function accumulateStreamToolCalls(
  acc: WireToolCall[],
  chunk: unknown,
): void {
  if (!chunk || typeof chunk !== "object") return;
  const res = chunk as TextGenerationStreamChunk;
  const fragments =
    res.choices?.[0]?.delta?.tool_calls ?? res.tool_calls ?? undefined;
  if (!Array.isArray(fragments)) return;

  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== "object") continue;

    const id = typeof fragment.id === "string" ? fragment.id : "";
    const name = fragment.function?.name ?? fragment.name;
    const rawArgs = fragment.function?.arguments ?? fragment.arguments;
    const objectArgs =
      rawArgs !== null && typeof rawArgs === "object" ? rawArgs : undefined;

    // A call is identified by its provider id, never by the stream `index`:
    // some providers reuse the index across calls, and keying on it merges two
    // calls into one slot (concatenating their arguments). A fragment that
    // carries an id opens or continues that call.
    let call = id ? acc.find((c) => c.id === id) : undefined;

    // Without an id, a legacy complete call (name + object arguments) opens its
    // own entry; otherwise the fragment continues the most recent call, which
    // is where the payload fragments following a header belong.
    if (!call) {
      if (!id && !(typeof name === "string" && objectArgs)) {
        call = acc[acc.length - 1];
      }
      if (!call) {
        call = { id: id || `call_${acc.length}`, name: "", arguments: "" };
        acc.push(call);
      }
    }

    if (typeof name === "string" && name) call.name = name;
    if (typeof rawArgs === "string") call.arguments += rawArgs;
    else if (objectArgs) call.arguments += JSON.stringify(objectArgs);
  }
}

/**
 * Extract a human-readable message from an upstream error value. The error may
 * be a bare string or an object carrying a `message`; callers supply their own
 * fallback when nothing usable is found.
 */
export function readUpstreamErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return undefined;
}
