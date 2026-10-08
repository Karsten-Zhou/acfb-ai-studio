import { describe, expect, it } from "vitest";
import { reasoningParams } from "@shared/reasoning";
import {
  getReasoningOptions,
  getReasoningTraits,
} from "@shared/generated/traits";

describe("generated reasoning traits", () => {
  it("derives qwen3.8-27b's levels from its schema enum + toggle", () => {
    // Real catalogue entry: enum low/medium/xhigh, and a free enable_thinking
    // toggle, so `none` is offered too.
    expect(getReasoningOptions("@cf/qwen/qwen3.8-27b")).toEqual([
      "none",
      "low",
      "medium",
      "xhigh",
    ]);
    expect(
      reasoningParams(getReasoningTraits("@cf/qwen/qwen3.8-27b"), "xhigh"),
    ).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: "xhigh",
    });
  });

  it("reports no control for a model with no reasoning knob", () => {
    expect(getReasoningOptions("@cf/meta/llama-3.2-1b-instruct")).toEqual([]);
  });
});
