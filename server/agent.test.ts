import { describe, expect, it } from "vitest";
import { streamingAgent } from "./agent";

/** Split raw bytes at the given offsets into a stream the agent can read. */
function byteStream(
  input: string,
  splitAt: number[] = [],
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(input);
  const chunks: Uint8Array[] = [];
  const cuts = [0, ...splitAt, bytes.length];
  for (let i = 1; i < cuts.length; i++) {
    chunks.push(bytes.slice(cuts[i - 1], cuts[i]));
  }
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
  });
}

/** Run one reply through the agent and return its `data:` event lines. */
async function run(
  input: string,
  {
    toolsEnabled = false,
    splitAt = [],
  }: { toolsEnabled?: boolean; splitAt?: number[] } = {},
): Promise<string[]> {
  const stream = streamingAgent({
    baseParams: {},
    messages: [],
    toolsEnabled,
    runStream: async () => byteStream(input, splitAt),
  });
  const text = await new Response(stream).text();
  return text.split("\n").filter((l) => l.startsWith("data:"));
}

const has = (out: string[], type: string): boolean =>
  out.some((l) => l.includes(`"type":"${type}"`));

describe("streamingAgent", () => {
  it("emits deltas and done for a well-formed stream", async () => {
    const out = await run(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + "data: [DONE]\n\n",
    );
    expect(out).toContain('data: {"type":"delta","delta":"hi"}');
    expect(out).toContain('data: {"type":"done"}');
    expect(has(out, "error")).toBe(false);
  });

  it("surfaces the binding's bare failure line when [DONE] never arrives", async () => {
    // Exact bytes captured from the live binding when generation died before
    // any event (here: a negative max_tokens). No `data:` line, no `[DONE]`.
    const raw =
      "$error: Error: ResultStream: failed to parse incoming data: ERROR 3005: " +
      "triton error running inference: error during inference: Error generating " +
      "stream: max_tokens must be at least 1, got -3283.\n\n";

    const out = await run(raw);
    const errorEvent = out.find((l) => l.includes('"type":"error"'));
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toContain("max_tokens must be at least 1, got -3283.");
    // `done` means success: it must not follow an error.
    expect(has(out, "done")).toBe(false);
  });

  it("surfaces a bare failure line with no trailing newline and no done", async () => {
    const raw =
      "$error: Error: ResultStream: max_tokens must be at least 1, got -3283.";
    const out = await run(raw);
    expect(has(out, "error")).toBe(true);
    expect(has(out, "done")).toBe(false);
  });

  it("reports a truncated stream (data, no [DONE]) with no done", async () => {
    const out = await run('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    expect(has(out, "error")).toBe(true);
    expect(has(out, "done")).toBe(false);
  });

  it("forwards a `data:` error event and does not emit done", async () => {
    const out = await run('data: {"error":"boom"}\n\ndata: [DONE]\n\n');
    expect(out).toContain('data: {"type":"error","message":"boom"}');
    expect(has(out, "done")).toBe(false);
  });

  it("ignores SSE framing lines that are not `data:`", async () => {
    const out = await run(
      "event: message\nid: 1\n" +
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(out).toContain('data: {"type":"delta","delta":"hi"}');
    expect(has(out, "error")).toBe(false);
    expect(has(out, "done")).toBe(true);
  });

  it("decodes a UTF-8 character split across chunks", async () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n' +
      "data: [DONE]\n\n";
    const prefix = 'data: {"choices":[{"delta":{"content":"'.length;
    // Split inside the first 3-byte character.
    const out = await run(raw, {
      splitAt: [new TextEncoder().encode(raw.slice(0, prefix)).length + 1],
    });
    expect(out.some((l) => l.includes("你好"))).toBe(true);
    expect(has(out, "error")).toBe(false);
  });

  it("combines a multi-line data event into one delta", async () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"hi"\n' +
      "data: }}]}\n\n" +
      "data: [DONE]\n\n";
    const out = await run(raw);
    expect(has(out, "delta")).toBe(true);
    expect(has(out, "error")).toBe(false);
  });

  it("ignores a tool call when no tools were offered", async () => {
    const out = await run(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_current_datetime","arguments":"{}"}}]}}]}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(has(out, "tool_call")).toBe(false);
    expect(has(out, "tool_result")).toBe(false);
    expect(has(out, "done")).toBe(true);
  });
});
