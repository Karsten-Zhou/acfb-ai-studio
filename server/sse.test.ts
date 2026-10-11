import { describe, expect, it } from "vitest";
import { canonicalEventStream } from "./sse";

/** Feed raw upstream bytes through the transform and return the `data:` lines. */
async function run(input: string): Promise<string[]> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input));
      controller.close();
    },
  });
  const text = await new Response(
    stream.pipeThrough(canonicalEventStream()),
  ).text();
  return text.split("\n").filter((l) => l.startsWith("data:"));
}

describe("canonicalEventStream", () => {
  it("emits deltas and done for a well-formed stream", async () => {
    const out = await run(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + "data: [DONE]\n\n",
    );
    expect(out).toContain('data: {"type":"delta","delta":"hi"}');
    expect(out).toContain('data: {"type":"done"}');
    expect(out.join("\n")).not.toContain('"type":"error"');
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
  });

  it("reports a truncated stream (data, no [DONE])", async () => {
    const out = await run('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    expect(out.join("\n")).toContain('"type":"error"');
  });

  it("still forwards a `data:` error event", async () => {
    const out = await run('data: {"error":"boom"}\n\ndata: [DONE]\n\n');
    expect(out).toContain('data: {"type":"error","message":"boom"}');
  });

  it("ignores SSE framing lines that are not `data:`", async () => {
    const out = await run(
      "event: message\nid: 1\n" +
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(out).toContain('data: {"type":"delta","delta":"hi"}');
    expect(out.join("\n")).not.toContain('"type":"error"');
  });
});
