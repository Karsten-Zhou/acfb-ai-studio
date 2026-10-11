import { describe, expect, it } from "vitest";
import { upstreamFrames, readSseError, type UpstreamFrame } from "./sse-parse";

const enc = new TextEncoder();

/** Run raw upstream text (split at the given byte cuts) through the frames. */
async function parse(
  text: string,
  splitAt: number[] = [],
): Promise<{ payloads: unknown[]; failure: string | undefined }> {
  const bytes = enc.encode(text);
  const chunks: Uint8Array[] = [];
  const cuts = [0, ...splitAt, bytes.length];
  for (let i = 1; i < cuts.length; i++) {
    chunks.push(bytes.slice(cuts[i - 1], cuts[i]));
  }
  let index = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
  });

  const frames: UpstreamFrame[] = [];
  const reader = source.pipeThrough(upstreamFrames()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    frames.push(value);
  }

  const payloads = frames
    .filter(
      (f): f is Extract<UpstreamFrame, { kind: "payload" }> =>
        f.kind === "payload",
    )
    .map((f) => f.payload);
  const failure = frames.find((f) => f.kind === "failure")?.message;
  return { payloads, failure };
}

describe("upstreamFrames", () => {
  it("returns parsed JSON for data events and completes on [DONE]", async () => {
    const r = await parse(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + "data: [DONE]\n\n",
    );
    expect(r.payloads).toEqual([{ choices: [{ delta: { content: "hi" } }] }]);
    expect(r.failure).toBeUndefined();
  });

  it("ignores event:/id:/retry: framing without flagging a failure", async () => {
    const r = await parse(
      "event: message\nid: 1\nretry: 1000\n" + "data: [DONE]\n\n",
    );
    expect(r.failure).toBeUndefined();
  });

  it("surfaces a complete bare failure line verbatim (the captured binding case)", async () => {
    // Exact shape captured from the live binding: a complete (newline-ended)
    // non-SSE `$error` line, no `data:` and no `[DONE]`.
    const r = await parse(
      "$error: Error: ... max_tokens must be at least 1, got -3283.\n\n",
    );
    expect(r.failure).toContain("max_tokens must be at least 1, got -3283.");
  });

  it("still fails (generically) for a bare error with no terminator", async () => {
    // eventsource-parser v4 discards an invalid line that never completes, so
    // the verbatim text is unavailable — but the missing [DONE] still fails
    // the stream rather than resolving as an empty success.
    const r = await parse(
      "$error: Error: ... max_tokens must be at least 1, got -3283.",
    );
    expect(r.failure).toMatch(/ended before/);
  });

  it("still fails (generically) for a bare error split across chunks", async () => {
    const raw =
      "$error: Error: ResultStream: failed to parse incoming data: ERROR 3005";
    const r = await parse(raw, [Math.floor(raw.length / 2)]);
    expect(r.failure).toMatch(/ended before/);
  });

  it("falls back to a generic message when nothing arrived", async () => {
    expect((await parse("")).failure).toMatch(/ended before/);
  });

  it("reports a truncated stream (data, no [DONE])", async () => {
    const r = await parse('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    expect(r.failure).toMatch(/ended before/);
  });

  it("reassembles a UTF-8 multibyte character split across chunks", async () => {
    const text = 'data: {"c":"你好"}\n\n' + "data: [DONE]\n\n";
    const cut = enc.encode('data: {"c":"').length + 1; // inside 你's 3 bytes
    const r = await parse(text, [cut]);
    expect((r.payloads[0] as { c: string }).c).toBe("你好");
    expect(r.failure).toBeUndefined();
  });

  it("combines multiple data: lines of one event into one payload", async () => {
    // SSE joins repeated `data:` fields with a newline; whitespace around the
    // split keeps the JSON valid.
    const r = await parse('data: {"a":\ndata:  1}\n\n' + "data: [DONE]\n\n");
    expect(r.payloads[0]).toEqual({ a: 1 });
  });

  it("treats malformed JSON followed by [DONE] as a failure", async () => {
    const r = await parse("data: {not json\n\n" + "data: [DONE]\n\n");
    expect(r.failure).toMatch(/malformed data/);
    expect(r.failure).toContain("{not json");
  });

  it("recognizes [DONE] even without a terminating blank line", async () => {
    expect((await parse("data: [DONE]\n")).failure).toBeUndefined();
    expect((await parse("data: [DONE]")).failure).toBeUndefined();
  });
});

describe("readSseError", () => {
  it("reads a singular error event", () => {
    expect(readSseError({ error: "boom" })).toBe("boom");
  });
  it("returns undefined for a non-error payload", () => {
    expect(readSseError({ choices: [] })).toBeUndefined();
  });
});
