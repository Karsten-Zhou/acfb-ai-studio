// Client-side consumption of the canonical chat SSE response.
//
// Kept out of the Pinia store so the completion contract can be unit-tested
// without a live fetch. Framing is handled by `eventsource-parser`; this only
// validates each event against `streamEventSchema` and enforces the terminal
// `done`: a server→browser stream that ends without it (a dropped connection
// or crashed worker) rejects instead of resolving into an apparently whole,
// possibly empty reply. This is independent of the server's own upstream
// `[DONE]` validation.

import { EventSourceParserStream } from "eventsource-parser/stream";
import { streamEventSchema, type ToolCall } from "@shared/chat";

export type StreamDelta = {
  content?: string;
  reasoning?: string;
  toolCall?: ToolCall;
  toolResult?: { id: string; name: string; result: string; error?: string };
};

/**
 * Read a canonical chat event stream to completion. Resolves only after an
 * explicit `{ type: "done" }`; rejects with the server's message on an
 * `{ type: "error" }` event, or when the body ends before `done`.
 */
export async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: StreamDelta) => void,
  signal?: AbortSignal,
): Promise<void> {
  let streamError: string | undefined;
  let sawDone = false;
  /**
   * Frames the binding sent that this parser cannot use. Counted, so a broken
   * upstream produces one warning per stream instead of one per chunk.
   */
  let malformedFrames = 0;

  function reportMalformed(reason: string, detail?: unknown): void {
    malformedFrames++;
    if (malformedFrames > 1) return;
    // Never log the frame body: it is conversation content. The reason and the
    // offending field paths are enough to find the bug, which is in the binding.
    console.warn(`[chat-stream] discarding a frame (${reason})`, detail ?? "");
  }

  function handlePayload(payload: string): void {
    if (!payload) return;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      // The `SyntaxError` message can quote the input, so the error object
      // stays out of the log.
      reportMalformed("not JSON");
      return;
    }
    const parsed = streamEventSchema.safeParse(json);
    if (!parsed.success) {
      reportMalformed(
        "not a stream event",
        parsed.error.issues.map((issue) => issue.path.join(".") || "(root)"),
      );
      return;
    }

    const event = parsed.data;
    if (event.type === "error") {
      streamError = event.message;
      return;
    }
    if (event.type === "done") {
      sawDone = true;
      return;
    }
    if (event.type === "delta" && (event.delta || event.reasoning)) {
      onDelta({ content: event.delta, reasoning: event.reasoning });
    }
    if (event.type === "tool_call") {
      onDelta({
        toolCall: {
          id: event.id,
          name: event.name,
          arguments: event.arguments,
        },
      });
    }
    if (event.type === "tool_result") {
      onDelta({
        toolResult: {
          id: event.id,
          name: event.name,
          result: event.result,
          error: event.error,
        },
      });
    }
  }

  // Framing is delegated to `eventsource-parser`: `TextDecoderStream` handles
  // incremental UTF-8, the terminator guarantees a final event boundary, and
  // `EventSourceParserStream` yields the canonical `data:` event bodies.
  const terminator = new TransformStream<string, string>({
    flush(controller) {
      controller.enqueue("\n\n");
    },
  });
  // lib.dom types TextDecoderStream's writable as `BufferSource`; at runtime it
  // consumes the body's `Uint8Array` chunks. Narrow locally for `pipeThrough`.
  const decoder = new TextDecoderStream() as unknown as TransformStream<
    Uint8Array,
    string
  >;
  const eventReader = body
    .pipeThrough(decoder)
    .pipeThrough(terminator)
    .pipeThrough(new EventSourceParserStream())
    .getReader();

  // Cancelling the final reader on teardown propagates back through the pipe
  // to the response body so it is not left locked after an error or abort.
  try {
    for (;;) {
      const { value, done } = await eventReader.read();
      if (done) break;
      handlePayload(value.data);
      if (streamError) break;
    }
  } finally {
    // Nothing to report here: the reader is being discarded, and the reason we
    // are tearing down (`streamError`, an abort, or a missing `done`) is thrown
    // by this function itself a few lines below.
    await eventReader.cancel().catch(() => {});
  }

  if (streamError) throw new Error(streamError);

  if (!sawDone) {
    throw new Error(
      signal?.aborted
        ? "Generation stopped."
        : "The response stream ended before it finished.",
    );
  }

  // `done` still arrives after a frame is discarded, so without this the reply
  // reads as finished while the content of every dropped delta is missing.
  if (malformedFrames > 0) {
    throw new Error("The response contained data this app could not read.");
  }
}
