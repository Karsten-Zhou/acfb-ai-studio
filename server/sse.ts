// Turn the parsed upstream frames from `./sse-parse` into the canonical stream
// events (`streamEventSchema` in `@shared/chat`). Framing and failure rules
// live in `./sse-parse`, shared with the agent's own reader; `./inference`
// owns the per-event shape parsing.

import { readStreamChunk } from "./inference";
import { readSseError, type UpstreamFrame } from "./sse-parse";

const encoder = new TextEncoder();

export function encodeSseEvent(event: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Map {@link UpstreamFrame}s onto canonical SSE bytes. Feed it the readable
 * side of `upstreamFrames()`: `upstream.pipeThrough(upstreamFrames())
 * .pipeThrough(canonicalEventStream())`.
 *
 * `done` is emitted only on an unequivocally successful stream — never after a
 * frame-level or in-band error — so the client can treat its absence (once the
 * body ends) as a failure.
 */
export function canonicalEventStream(): TransformStream<
  UpstreamFrame,
  Uint8Array
> {
  let errored = false;

  // Returns true when the payload was an in-band `{ error }` event.
  function emitPayload(
    payload: unknown,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): boolean {
    const error = readSseError(payload);
    if (error !== undefined) {
      controller.enqueue(encodeSseEvent({ type: "error", message: error }));
      return true;
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
    return false;
  }

  return new TransformStream<UpstreamFrame, Uint8Array>({
    transform(frame, controller) {
      if (frame.kind === "failure") {
        // A stream that never saw `[DONE]` failed inside the 200 response —
        // the only failure signal available once the headers are sent.
        controller.enqueue(
          encodeSseEvent({ type: "error", message: frame.message }),
        );
        errored = true;
        return;
      }
      if (emitPayload(frame.payload, controller)) errored = true;
    },

    flush(controller) {
      if (!errored) controller.enqueue(encodeSseEvent({ type: "done" }));
    },
  });
}
