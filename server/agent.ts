// The server-side tool-calling loop.
//
// Workers AI's traditional function-calling flow (see
// https://developers.cloudflare.com/workers-ai/features/function-calling/)
// feeds the model back through *plain* messages: the assistant turn that asked
// for a tool is replayed as `{ role: "assistant", content: JSON.stringify(call) }`
// and the result as `{ role: "tool", content: JSON.stringify(result) }`. The
// message schema declares only `role` and `content`, so there is no
// OpenAI-style `tool_calls` / `tool_call_id` to use.
//
// A tool call arrives split across stream fragments: a header (name + id) and
// one or more payload fragments carrying the argument JSON. Measured gaps
// between the two run from ~100ms (tiny args) to several seconds (long args), so
// the call is announced to the client the moment its name arrives — letting the
// UI show a pending step while the model is still writing the arguments.
//
// The loop is bounded by MAX_STEPS; a model that keeps requesting tools forever
// would otherwise hang the request.

import type { ToolCall } from "@shared/chat";
import {
  accumulateStreamToolCalls,
  readInferenceResult,
  readStreamChunk,
  readToolCalls,
  readUpstreamErrorMessage,
  type WireToolCall,
} from "./inference";
import { executeToolCall, type ToolExecution } from "./tools";
import { encodeSseEvent } from "./sse";

/** Hard cap on model↔tool round trips within a single reply. */
const MAX_STEPS = 5;

/**
 * The assistant echo of the tool calls a model requested. Content is the JSON
 * of `{ name, arguments }` (a single object, or an array for parallel calls),
 * exactly as the documented traditional flow feeds it back.
 */
function assistantToolCallMessage(
  calls: WireToolCall[],
): Record<string, unknown> {
  const encoded = calls.map((call) => ({
    name: call.name,
    arguments: safeArguments(call.arguments),
  }));
  return {
    role: "assistant",
    content: JSON.stringify(encoded.length === 1 ? encoded[0] : encoded),
  };
}

/** The plain `tool` message returning one tool's result. */
function toolResultMessage(res: ToolExecution): Record<string, unknown> {
  return {
    role: "tool",
    content: res.result ?? JSON.stringify({ error: res.error ?? "failed" }),
  };
}

/** Parse a tool-call arguments string, passing a raw string through on failure. */
function safeArguments(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function toToolCall(call: WireToolCall): ToolCall {
  return {
    id: call.id || crypto.randomUUID(),
    name: call.name,
    arguments: call.arguments || "{}",
  };
}

// ---------------------------------------------------------------------------
// Streaming agent
// ---------------------------------------------------------------------------

export interface StreamingAgentOptions {
  /** Prebuilt non-message params (temperature, reasoning, tools, ...). */
  baseParams: Record<string, unknown>;
  /** The starting wire messages; a copy is mutated across steps. */
  messages: unknown[];
  /** Start one streaming model call; resolves to the upstream byte stream. */
  runStream: (
    messages: unknown[],
    params: Record<string, unknown>,
  ) => Promise<ReadableStream<Uint8Array>>;
}

/**
 * Produce the canonical SSE byte stream for a tool-enabled reply. Content and
 * reasoning deltas stream through as they arrive; a tool call is announced as
 * soon as it starts and its result follows once it has run.
 */
export function streamingToolAgent(
  options: StreamingAgentOptions,
): ReadableStream<Uint8Array> {
  const { baseParams, runStream } = options;
  const messages = [...options.messages];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: object) => controller.enqueue(encodeSseEvent(event));
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const stream = await runStream(messages, {
            ...baseParams,
            stream: true,
          });

          const calls: WireToolCall[] = [];
          // Last announced signature per call index, so an unchanged fragment
          // is not re-sent.
          const announced = new Map<number, string>();
          let failed = false;

          for await (const chunk of parseUpstreamSse(stream)) {
            const error = readUpstreamError(chunk);
            if (error) {
              emit({ type: "error", message: error });
              failed = true;
              break;
            }
            accumulateStreamToolCalls(calls, chunk);
            // Announce each call as soon as its name arrives — long before its
            // arguments finish generating — so the UI can show a pending step.
            calls.forEach((call, index) => {
              if (!call || !call.name) return;
              if (!call.id) call.id = `call_${index}`;
              const signature = `${call.name}|${call.arguments}`;
              if (announced.get(index) === signature) return;
              announced.set(index, signature);
              emit({
                type: "tool_call",
                id: call.id,
                name: call.name,
                arguments: call.arguments || "{}",
              });
            });

            const delta = readStreamChunk(chunk);
            if (delta.reasoning) {
              emit({ type: "delta", reasoning: delta.reasoning });
            }
            if (delta.content) {
              emit({ type: "delta", delta: delta.content });
            }
          }
          if (failed) return;
          const requested = calls.filter((call) => call.name);
          if (requested.length === 0) break;

          messages.push(assistantToolCallMessage(requested));

          // Run the round's tools concurrently: they are pure and keyed by id,
          // and the client upserts results by id, so out-of-order completion is
          // harmless. All results are awaited before the next round starts, so
          // the model always sees every tool reply together.
          const executions = await Promise.all(
            requested.map((call) => executeToolCall(toToolCall(call))),
          );
          for (const execution of executions) {
            emit({
              type: "tool_result",
              id: execution.id,
              name: execution.name,
              result: execution.result ?? "",
              ...(execution.error ? { error: execution.error } : {}),
            });
            messages.push(toolResultMessage(execution));
          }
        }
        emit({ type: "done" });
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Non-streaming agent
// ---------------------------------------------------------------------------

export interface NonStreamingAgentOptions {
  baseParams: Record<string, unknown>;
  messages: unknown[];
  runOnce: (
    messages: unknown[],
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}

/** Tool-calling steps plus the final answer, for the non-streaming endpoint. */
export interface NonStreamingAgentResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
}

export async function nonStreamingToolAgent(
  options: NonStreamingAgentOptions,
): Promise<NonStreamingAgentResult> {
  const { baseParams, runOnce } = options;
  const messages = [...options.messages];
  const toolCalls: ToolCall[] = [];
  let content = "";
  let reasoning = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await runOnce(messages, { ...baseParams, stream: false });
    const read = readInferenceResult(result);
    content = read.content;
    reasoning = read.reasoning;

    const calls = readToolCalls(result).filter((call) => call.name);
    if (calls.length === 0) break;

    messages.push(assistantToolCallMessage(calls));
    const executions = await Promise.all(
      calls.map((call) => executeToolCall(toToolCall(call))),
    );
    for (let i = 0; i < calls.length; i++) {
      const toolCall = toToolCall(calls[i]);
      const execution = executions[i];
      toolCalls.push({
        ...toolCall,
        result: execution.result,
        ...(execution.error ? { error: execution.error } : {}),
      });
      messages.push(toolResultMessage(execution));
    }
  }

  return { content, reasoning, toolCalls };
}

// ---------------------------------------------------------------------------
// Upstream SSE parsing
// ---------------------------------------------------------------------------

/**
 * Parse an upstream Workers AI SSE stream into the JSON payload of each `data:`
 * line. Non-JSON sentinels and `[DONE]` are skipped, exactly as the canonical
 * transform does.
 */
async function* parseUpstreamSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload) as unknown;
        } catch {
          // A non-JSON upstream line carries no contract event.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Read a human-readable message out of an upstream `{ error }` payload. */
function readUpstreamError(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("error" in value)) return;
  return (
    readUpstreamErrorMessage((value as { error: unknown }).error) ??
    "The model stream failed."
  );
}
