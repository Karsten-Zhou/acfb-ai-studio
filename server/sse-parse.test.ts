import { describe, expect, it } from "vitest";
import { LineBuffer, UpstreamSseParser, readSseError } from "./sse-parse";

describe("UpstreamSseParser", () => {
  it("returns parsed JSON for data events and marks [DONE]", () => {
    const p = new UpstreamSseParser();
    expect(p.push('data: {"choices":[{"delta":{"content":"hi"}}]}')).toEqual({
      choices: [{ delta: { content: "hi" } }],
    });
    expect(p.complete).toBe(false);
    expect(p.push("data: [DONE]")).toBeUndefined();
    expect(p.complete).toBe(true);
    expect(p.finish()).toBeUndefined();
  });

  it("ignores event:/id:/retry: framing without flagging a failure", () => {
    const p = new UpstreamSseParser();
    p.push("event: message");
    p.push("id: 1");
    p.push("data: [DONE]");
    expect(p.finish()).toBeUndefined();
  });

  it("reports a stream that ended without [DONE], verbatim stray line first", () => {
    const p = new UpstreamSseParser();
    p.push("$error: Error: ... max_tokens must be at least 1, got -3283.");
    expect(p.finish()).toContain("max_tokens must be at least 1, got -3283.");
  });

  it("falls back to a generic message when nothing arrived", () => {
    expect(new UpstreamSseParser().finish()).toMatch(/ended before/);
  });
});

describe("LineBuffer", () => {
  it("reassembles lines split across chunks", () => {
    const b = new LineBuffer();
    const enc = new TextEncoder();
    expect(b.push(enc.encode('data: {"a"'))).toEqual([]);
    expect(b.push(enc.encode(":1}\n")).join("")).toBe('data: {"a":1}');
    expect(b.flush()).toEqual([]);
  });

  it("flushes a trailing line with no newline", () => {
    const b = new LineBuffer();
    b.push(new TextEncoder().encode("data: x"));
    expect(b.flush()).toEqual(["data: x"]);
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
