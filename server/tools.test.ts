import { describe, expect, it } from "vitest";
import {
  accumulateStreamToolCalls,
  readToolCalls,
  type WireToolCall,
} from "./inference";
import { executeToolCall } from "./tools";
import { supportsToolCalling } from "@shared/generated/traits";
import { toWireTools } from "@shared/tools";

describe("readToolCalls", () => {
  it("reads OpenAI-style function tool calls", () => {
    expect(
      readToolCalls({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "get_x", arguments: '{"a":1}' },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([{ id: "call_1", name: "get_x", arguments: '{"a":1}' }]);
  });

  it("normalises the legacy flat shape, stringifying object arguments", () => {
    expect(
      readToolCalls({
        tool_calls: [{ name: "get_x", arguments: { a: 1 } }],
      }),
    ).toEqual([{ id: "call_0", name: "get_x", arguments: '{"a":1}' }]);
  });

  it("returns an empty list when there are no tool calls", () => {
    expect(readToolCalls({ response: "hi" })).toEqual([]);
    expect(readToolCalls(undefined)).toEqual([]);
  });
});

describe("accumulateStreamToolCalls", () => {
  it("concatenates argument fragments of one call by index", () => {
    const acc: WireToolCall[] = [];
    accumulateStreamToolCalls(acc, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "c1",
                function: { name: "get_x", arguments: '{"a"' },
              },
            ],
          },
        },
      ],
    });
    accumulateStreamToolCalls(acc, {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] },
        },
      ],
    });
    expect(acc).toEqual([{ id: "c1", name: "get_x", arguments: '{"a":1}' }]);
  });

  it("ignores chunks without tool calls", () => {
    const acc: WireToolCall[] = [];
    accumulateStreamToolCalls(acc, { response: "hi" });
    expect(acc).toEqual([]);
  });
});

describe("executeToolCall", () => {
  it("runs get_current_datetime and returns structured fields", async () => {
    const result = await executeToolCall({
      id: "1",
      name: "get_current_datetime",
      arguments: "{}",
    });
    expect(result.error).toBeUndefined();
    const parsed = JSON.parse(result.result!) as Record<string, string>;
    expect(parsed.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.timezone).toBeTruthy();
  });

  it("rejects an unknown tool rather than dispatching it", async () => {
    const result = await executeToolCall({
      id: "1",
      name: "delete_everything",
      arguments: "{}",
    });
    expect(result.error).toMatch(/Unknown tool/);
  });

  it("reports malformed arguments as an error", async () => {
    const result = await executeToolCall({
      id: "1",
      name: "get_current_datetime",
      arguments: "{not json",
    });
    expect(result.error).toBeTruthy();
  });
});

describe("supportsToolCalling", () => {
  it("is true only for models whose schema declares `tools`", () => {
    expect(supportsToolCalling("@cf/openai/gpt-oss-20b")).toBe(true);
    // `function_calling` flag is set upstream, but the schema has no `tools`.
    expect(
      supportsToolCalling("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
    ).toBe(false);
  });
});

describe("toWireTools", () => {
  it("emits the nested OpenAI function shape", () => {
    // Regression: the flat `{ name, description, parameters }` form is
    // rejected with `8001: Invalid input` by several OpenAI-compatible models
    // (verified against the live API), while the nested form is accepted by
    // every tool-capable model.
    const wire = toWireTools(["get_current_datetime"]);
    expect(wire).toHaveLength(1);
    const first = wire[0] as Record<string, unknown>;
    expect(first.type).toBe("function");
    expect(first).toHaveProperty("function");
    const fn = first.function as Record<string, unknown>;
    expect(fn.name).toBe("get_current_datetime");
    expect(typeof fn.description).toBe("string");
    expect(fn.parameters).toBeTruthy();
  });

  it("drops unknown ids", () => {
    expect(toWireTools(["does_not_exist"])).toEqual([]);
  });
});
