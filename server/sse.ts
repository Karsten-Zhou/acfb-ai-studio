// Transform Cloudflare's upstream SSE into the canonical stream events
// (`streamEventSchema` in `@shared/chat`). Framing and failure rules live in
// `./sse-parse`, shared with the agent's own reader; `./inference` owns the
// per-event shape parsing.

import { readStreamChunk } from "./inference";
import { LineBuffer, UpstreamSseParser, readSseError } from "./sse-parse";

const encoder = new TextEncoder();

export function encodeSseEvent(event: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function canonicalEventStream(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const lines = new LineBuffer();
  const parser = new UpstreamSseParser();

  function emitPayload(
    payload: unknown,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void {
    const error = readSseError(payload);
    if (error !== undefined) {
      controller.enqueue(encodeSseEvent({ type: "error", message: error }));
      return;
    }

    const { content, reasoning } = readStreamChunk(payload);
    if (content !== undefined || reasoning !== undefined) {
      controller.enqueue(
        encodeSseEvent({
          type: "delta",
          ...(content !== undefined ? { delta: content } : {}),
          ...(reasoning !== undefined ? { reasoning } : {}),
        }),
      );
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      for (const line of lines.push(chunk)) {
        const payload = parser.push(line);
        if (payload !== undefined) emitPayload(payload, controller);
      }
    },

    flush(controller) {
      for (const line of lines.flush()) {
        const payload = parser.push(line);
        if (payload !== undefined) emitPayload(payload, controller);
      }

      // A stream that never saw `[DONE]` failed inside the 200 response — the
      // only failure signal available once the headers are sent. Emitting
      // nothing here is what made the UI show an empty, successful reply.
      const failure = parser.finish();
      if (failure !== undefined) {
        controller.enqueue(encodeSseEvent({ type: "error", message: failure }));
      }
      controller.enqueue(encodeSseEvent({ type: "done" }));
    },
  });
}
