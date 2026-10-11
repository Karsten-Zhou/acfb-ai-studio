// Shared SSE reading for the two consumers of an upstream Workers AI stream:
// the byte-level transform in `./sse` and the agent's async generator in
// `./agent`. Their *reading shapes* differ — one is a TransformStream, the
// other drives a tool loop — but the framing and failure rules must be
// identical, so they live here once.
//
// A well-formed Workers AI stream ends with `data: [DONE]`. When generation
// fails after the (already-sent) 200 headers, the binding instead streams a
// bare, non-SSE line such as:
//   `$error: Error: ResultStream: ... max_tokens must be at least 1, got -3283.`
// That shape is undocumented, so it is surfaced verbatim rather than parsed.

import { readUpstreamErrorMessage } from "./inference";

/** A well-formed Workers AI stream terminates with this sentinel. */
export const DONE_SENTINEL = "[DONE]";

/** Cap on an upstream failure line echoed to the client. */
export const MAX_ERROR_BODY = 500;

/** SSE field prefixes; any other non-blank line is not SSE framing. */
export function isSseField(line: string): boolean {
  return (
    line.startsWith("data:") ||
    line.startsWith("event:") ||
    line.startsWith("id:") ||
    line.startsWith("retry:")
  );
}

/** Accumulates decoded bytes into complete lines. */
export class LineBuffer {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  /** Feed a chunk; return the complete lines it produced. */
  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const lines: string[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      lines.push(this.buffer.slice(0, newline).replace(/\r$/, ""));
      this.buffer = this.buffer.slice(newline + 1);
    }
    return lines;
  }

  /** Return any trailing line left without a newline. */
  flush(): string[] {
    if (this.buffer === "") return [];
    const line = this.buffer.replace(/\r$/, "");
    this.buffer = "";
    return [line];
  }
}

/**
 * Applies the upstream stream rules to decoded lines: recognises `data:`
 * events and the `[DONE]` terminator, records non-SSE failure lines, and
 * reports a stream that ended without `[DONE]`.
 */
export class UpstreamSseParser {
  private sawDone = false;
  private readonly strays: string[] = [];

  /** Whether the terminating sentinel has been seen. */
  get complete(): boolean {
    return this.sawDone;
  }

  /**
   * Process one logical line. Returns the parsed JSON of a `data:` event, or
   * `undefined` for framing, the sentinel, or an unparseable line.
   */
  push(line: string): unknown | undefined {
    // Blank lines separate events; `:` lines are comments.
    if (line === "" || line.startsWith(":")) return undefined;

    if (!isSseField(line)) {
      this.strays.push(line.trim());
      return undefined;
    }

    if (!line.startsWith("data:")) return undefined; // event:/id:/retry:
    const payload = line.slice(5).trim();
    if (!payload) return undefined;
    if (payload === DONE_SENTINEL) {
      this.sawDone = true;
      return undefined;
    }
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return undefined;
    }
  }

  /**
   * The failure message when the stream ended without `[DONE]`, else
   * `undefined`. Uses any stray line verbatim; falls back to a generic message.
   */
  finish(): string | undefined {
    if (this.sawDone) return undefined;
    const detail = this.strays.join("\n").trim();
    return detail.length > 0
      ? detail.slice(0, MAX_ERROR_BODY)
      : "The model stream ended before it finished.";
  }
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
