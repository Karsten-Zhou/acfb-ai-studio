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
