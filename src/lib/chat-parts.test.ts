import { describe, expect, it } from "vitest";
import type { AssistantSegment, ToolCall } from "@shared/chat";
import { buildAssistantParts, type TimelineItem } from "./chat-parts";

function call(overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: "c1", name: "get_time", arguments: "{}", ...overrides };
}

function types(items: TimelineItem[]): string[] {
  return items.map((item) => item.type);
}

function tools(items: TimelineItem[]) {
  return items.filter(
    (i): i is Extract<TimelineItem, { type: "tools" }> => i.type === "tools",
  );
}

describe("buildAssistantParts", () => {
  it("returns content only when nothing interrupts it", () => {
    const { reasoning, body } = buildAssistantParts({
      segments: [{ type: "content", text: "hello" }],
    });
    expect(reasoning).toEqual([]);
    expect(body).toEqual([{ type: "content", text: "hello" }]);
  });

  it("puts reasoning before content with no calls", () => {
    const { reasoning, body } = buildAssistantParts({
      segments: [
        { type: "reasoning", text: "think" },
        { type: "content", text: "answer" },
      ],
    });
    expect(reasoning).toEqual([{ type: "reasoning", text: "think" }]);
    expect(body).toEqual([{ type: "content", text: "answer" }]);
  });

  it("interleaves a call made mid-reasoning inside the reasoning region", () => {
    const segments: AssistantSegment[] = [
      { type: "reasoning", text: "before" },
      { type: "tool", id: "c1" },
      { type: "reasoning", text: " after" },
    ];
    const { reasoning, body } = buildAssistantParts({
      segments,
      toolCalls: [call()],
    });
    expect(types(reasoning)).toEqual(["reasoning", "tools", "reasoning"]);
    expect(tools(reasoning)[0].calls[0].id).toBe("c1");
    expect(body).toEqual([]);
  });

  it("keeps a reasoning-phase call before the answer", () => {
    const { reasoning, body } = buildAssistantParts({
      segments: [
        { type: "reasoning", text: "think" },
        { type: "tool", id: "c1" },
        { type: "content", text: "answer" },
      ],
      toolCalls: [call()],
    });
    expect(types(reasoning)).toEqual(["reasoning", "tools"]);
    expect(body).toEqual([{ type: "content", text: "answer" }]);
  });

  it("places a call made after content started in the answer body", () => {
    const { reasoning, body } = buildAssistantParts({
      segments: [
        { type: "content", text: "before " },
        { type: "tool", id: "c1" },
        { type: "content", text: "after" },
      ],
      toolCalls: [call()],
    });
    expect(reasoning).toEqual([]);
    expect(types(body)).toEqual(["content", "tools", "content"]);
    expect(body[0]).toEqual({ type: "content", text: "before " });
    expect(body[2]).toEqual({ type: "content", text: "after" });
  });

  it("moves a leading call with no reasoning into the body", () => {
    const { reasoning, body } = buildAssistantParts({
      segments: [
        { type: "tool", id: "c1" },
        { type: "content", text: "answer" },
      ],
      toolCalls: [call()],
    });
    expect(reasoning).toEqual([]);
    expect(types(body)).toEqual(["tools", "content"]);
  });

  it("groups consecutive tool segments into one step", () => {
    const { reasoning } = buildAssistantParts({
      segments: [
        { type: "reasoning", text: "r" },
        { type: "tool", id: "a" },
        { type: "tool", id: "b" },
        { type: "content", text: "x" },
      ],
      toolCalls: [call({ id: "a" }), call({ id: "b" })],
    });
    const grouped = tools(reasoning);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].calls.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("skips a tool segment whose call is missing", () => {
    const { body } = buildAssistantParts({
      segments: [
        { type: "tool", id: "ghost" },
        { type: "content", text: "hi" },
      ],
      toolCalls: [],
    });
    expect(body).toEqual([{ type: "content", text: "hi" }]);
  });

  it("renders a lone call with no prose as body tools", () => {
    const { body } = buildAssistantParts({
      segments: [{ type: "tool", id: "c1" }],
      toolCalls: [call()],
    });
    expect(tools(body)).toHaveLength(1);
  });

  it("keeps stray post-answer reasoning in the reasoning region", () => {
    const { reasoning, body } = buildAssistantParts({
      segments: [
        { type: "reasoning", text: "r1" },
        { type: "content", text: "answer" },
        { type: "reasoning", text: "r2" },
      ],
    });
    expect(reasoning).toEqual([{ type: "reasoning", text: "r1r2" }]);
    expect(body).toEqual([{ type: "content", text: "answer" }]);
  });
});
