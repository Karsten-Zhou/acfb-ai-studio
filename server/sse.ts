// Transform Cloudflare's upstream SSE into the canonical stream events
// (`streamEventSchema` in `@shared/chat`). Upstream-shape parsing lives in
// `./inference` (`readStreamChunk`).

import { readStreamChunk } from "./inference";

const encoder = new TextEncoder();

function sseLine(event: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** Read a human-readable message out of an upstream `{ error }` payload. */
function readUpstreamError(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "The model stream failed.";
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
            sseLine({
              type: "error",
              message: readUpstreamError((json as { error: unknown }).error),
            }),
          );
          continue;
        }

        const { content, reasoning } = readStreamChunk(json);
        if (content !== undefined || reasoning !== undefined) {
          controller.enqueue(
            sseLine({
              type: "delta",
              ...(content !== undefined ? { delta: content } : {}),
              ...(reasoning !== undefined ? { reasoning } : {}),
            }),
          );
        }
      }
    },

    flush(controller) {
      controller.enqueue(sseLine({ type: "done" }));
    },
  });
}
