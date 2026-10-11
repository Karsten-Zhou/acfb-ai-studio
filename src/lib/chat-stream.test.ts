import { describe, expect, it } from "vitest";
import { consumeChatStream, type StreamDelta } from "./chat-stream";

const enc = new TextEncoder();

/** Build a response body that streams `text`, optionally split at byte cuts. */
function body(
  text: string,
  splitAt: number[] = [],
): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
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

async function collect(text: string, cuts: number[] = []) {
  const deltas: StreamDelta[] = [];
  await consumeChatStream(body(text, cuts), (d) => deltas.push(d));
  return deltas;
}

describe("consumeChatStream", () => {
  it("resolves and collects deltas after an explicit done", async () => {
    const deltas = await collect(
      'data: {"type":"delta","delta":"Hello"}\n\n' +
        'data: {"type":"done"}\n\n',
    );
    expect(deltas).toEqual([{ content: "Hello" }]);
  });

  it("rejects when the connection ends without a done event", async () => {
    await expect(
      collect('data: {"type":"delta","delta":"Hello"}\n\n'),
    ).rejects.toThrow(/ended before it finished/);
  });

  it("rejects on an empty body (no events at all)", async () => {
    await expect(collect("")).rejects.toThrow(/ended before it finished/);
  });

  it("rejects with the server message on an error event", async () => {
    await expect(
      collect(
        'data: {"type":"error","message":"quota exceeded"}\n\n' +
          'data: {"type":"done"}\n\n',
      ),
    ).rejects.toThrow("quota exceeded");
  });

  it("dispatches tool_call and tool_result deltas", async () => {
    const deltas = await collect(
      'data: {"type":"tool_call","id":"c1","name":"get_time","arguments":"{}"}\n\n' +
        'data: {"type":"tool_result","id":"c1","name":"get_time","result":"12:00"}\n\n' +
        'data: {"type":"done"}\n\n',
    );
    expect(deltas[0].toolCall?.name).toBe("get_time");
    expect(deltas[1].toolResult?.result).toBe("12:00");
  });

  it("decodes a UTF-8 character split across chunks", async () => {
    const raw =
      'data: {"type":"delta","delta":"你好"}\n\n' + 'data: {"type":"done"}\n\n';
    const cut = 'data: {"type":"delta","delta":"'.length + 1;
    const deltas = await collect(raw, [cut]);
    expect(deltas[0].content).toBe("你好");
  });

  it("completes when done arrives without a trailing blank line", async () => {
    const deltas = await collect(
      'data: {"type":"delta","delta":"x"}\n\n' + 'data: {"type":"done"}',
    );
    expect(deltas).toHaveLength(1);
  });

  it("reports a stopped generation when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      consumeChatStream(
        body('data: {"type":"delta","delta":"x"}\n\n'),
        () => {},
        controller.signal,
      ),
    ).rejects.toThrow("Generation stopped.");
  });
});
