// Shared SSE reading for the two consumers of an upstream Workers AI stream:
// the byte-level transform in `./sse` and the agent's async generator in
// `./agent`. Their *reading shapes* differ — one is a TransformStream, the
// other drives a tool loop — but the framing and failure rules must be
// identical, so they live here once.
//
// Framing is delegated entirely to the maintained `eventsource-parser`
// library: `TextDecoderStream` handles chunk boundaries and incremental UTF-8
// (including flushing a trailing multi-byte sequence), and
// `EventSourceParserStream` implements the SSE event grammar (multi-line
// `data:`, `event:`/`id:`/`retry:` metadata). This module is only the
// Workers AI-specific policy layered on top:
//
//   * A well-formed stream ends with `data: [DONE]`.
//   * When generation fails after the (already-sent) 200 headers, the binding
//     streams a bare, non-SSE line such as:
//       `$error: Error: ResultStream: ... max_tokens must be at least 1, got -3283.`
//     That shape is undocumented. The parser reports a *complete* such line
//     through `onError` as an `unknown-field` carrying the original line, so
//     we surface it verbatim. (eventsource-parser v4 discards an invalid line
//     as soon as it proves it can never be a field — i.e. when it is split
//     across chunks or never gets a terminator — so a fragmented bare error is
//     not recoverable verbatim. It still carries no `[DONE]`, and therefore
//     still fails the stream below with the generic truncation message; it can
//     never resolve as a successful reply.)
//   * A `data:` frame whose body is not JSON is a malformed stream, not a
//     silently dropped frame.
//
// A tiny terminator transform appends a final blank line so that a trailing
// `data:` event or `[DONE]` that arrived without its blank line is still
// dispatched.

import {
  EventSourceParserStream,
  type EventSourceMessage,
  type ParseError,
} from "eventsource-parser/stream";
import { readUpstreamErrorMessage } from "./inference";

/** A well-formed Workers AI stream terminates with this sentinel. */
export const DONE_SENTINEL = "[DONE]";

/** Cap on an upstream failure body echoed to the client. */
export const MAX_ERROR_BODY = 500;

function clip(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > MAX_ERROR_BODY
    ? trimmed.slice(0, MAX_ERROR_BODY)
    : trimmed;
}

/** One semantic result of consuming an upstream stream. */
export type UpstreamFrame =
  | {
      kind: "payload";
      /** Parsed JSON body of a `data:` event. */
      payload: unknown;
    }
  | {
      kind: "failure";
      /** Terminal failure; the stream never completed. */
      message: string;
    };

/**
 * Parse an upstream Workers AI byte stream into {@link UpstreamFrame}s.
 *
 * Returns a TransformStream-shaped `{ writable, readable }` for direct use
 * with `pipeThrough`: raw bytes in, payload/failure frames out. A single
 * `failure` frame, when present, is always the last frame.
 */
export function upstreamFrames(): {
  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<UpstreamFrame>;
} {
  const strays: string[] = [];
  let malformed = "";
  let sawDone = false;

  const decoder = new TextDecoderStream();

  // Guarantee an event boundary at EOF so the last frame / `[DONE]` is not
  // held back for want of a final blank line.
  const terminator = new TransformStream<string, string>({
    flush(controller) {
      controller.enqueue("\n\n");
    },
  });

  const sse = new EventSourceParserStream({
    onError(error) {
      const pe = error as ParseError;
      // A complete unrecognized field is the binding's bare `$error: ...`
      // failure. `pe.line` is its original raw line. (`invalid-retry` is
      // treated identically; both are evidence of a non-conforming stream.)
      if (
        (pe.type === "unknown-field" || pe.type === "invalid-retry") &&
        pe.line
      ) {
        strays.push(pe.line.trim());
      }
    },
  });

  const policy = new TransformStream<EventSourceMessage, UpstreamFrame>({
    transform(event, controller) {
      const { data } = event;
      if (data === "") return;
      if (data === DONE_SENTINEL) {
        sawDone = true;
        return;
      }
      try {
        controller.enqueue({ kind: "payload", payload: JSON.parse(data) });
      } catch {
        // Distinguish malformed JSON from SSE framing: the frame was
        // well-formed but its body was not the JSON the binding is contracted
        // to send. Keep the first offender for the terminal message.
        if (!malformed) malformed = clip(data);
      }
    },

    flush(controller) {
      let message: string | undefined;
      if (malformed) {
        message = `The model stream sent malformed data: ${malformed}`;
      } else if (!sawDone) {
        const detail = strays.join("\n").trim();
        message = detail
          ? clip(detail)
          : "The model stream ended before it finished.";
      }
      if (message) controller.enqueue({ kind: "failure", message });
    },
  });

  // Wire the stages. A stage error (e.g. a max-buffer overflow) already errors
  // `policy.readable` for the consumer; swallowing the pipe promise just avoids
  // an unhandled rejection for that same propagated error.
  decoder.readable
    .pipeThrough(terminator)
    .pipeThrough(sse)
    .pipeTo(policy.writable)
    .catch(() => {});

  return { writable: decoder.writable, readable: policy.readable };
}

/**
 * If `payload` is an upstream `{ error }` event, its message; else `undefined`.
 * Shared so the transform and the agent treat an in-band error identically.
 */
export function readSseError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return undefined;
  }
  return (
    readUpstreamErrorMessage((payload as { error: unknown }).error) ??
    "The model stream failed."
  );
}
