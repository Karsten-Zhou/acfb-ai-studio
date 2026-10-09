// Transform Cloudflare's upstream SSE into the canonical stream events
// (`streamEventSchema` in `@shared/chat`). Upstream-shape parsing lives in
// `./inference` (`readStreamChunk`, `readUpstreamErrorMessage`).

import { readStreamChunk, readUpstreamErrorMessage } from "./inference";

const encoder = new TextEncoder();

export function encodeSseEvent(event: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function canonicalEventStream(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const decoder = new TextDecoder();
  // An upstream event may span chunks; carry the partial line here.
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);

        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let json: unknown;
        try {
          json = JSON.parse(payload);
        } catch {
          // A non-JSON upstream line carries no contract event.
          continue;
        }

        if (json && typeof json === "object" && "error" in json) {
          controller.enqueue(
            encodeSseEvent({
              type: "error",
              message:
                readUpstreamErrorMessage((json as { error: unknown }).error) ??
                "The model stream failed.",
            }),
          );
          continue;
        }

        const { content, reasoning } = readStreamChunk(json);
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
    },

    flush(controller) {
      controller.enqueue(encodeSseEvent({ type: "done" }));
    },
  });
}
