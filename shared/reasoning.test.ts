import { describe, expect, it } from "vitest";
import {
  normalizeReasoningEffort,
  reasoningControl,
  reasoningOptions,
  reasoningParams,
  type ReasoningTraits,
} from "./reasoning";

const graded = (values: string[]): ReasoningTraits => ({ graded: values });
const toggle = (param = "enable_thinking"): ReasoningTraits => ({
  graded: [],
  toggle: param,
});

describe("reasoningControl", () => {
  it("classifies graded, toggle, and none", () => {
    expect(reasoningControl(graded(["low", "high"]))).toBe("graded");
    expect(reasoningControl(toggle())).toBe("toggle");
    expect(reasoningControl({ graded: [] })).toBe("none");
  });
});

describe("reasoningOptions", () => {
  it("offers exactly the graded enum, plus none only when disableable", () => {
    // qwen3.8-27b shape: low/medium/xhigh, plus a toggle that can disable.
    expect(
      reasoningOptions({
        graded: ["low", "medium", "xhigh"],
        toggle: "enable_thinking",
      }),
    ).toEqual(["none", "low", "medium", "xhigh"]);
    // deepseek-v4: max/high/low/none, no toggle.
    expect(reasoningOptions(graded(["max", "high", "low", "none"]))).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
  });

  it("offers a binary toggle as none + a single on-level", () => {
    expect(reasoningOptions(toggle())).toEqual(["none", "medium"]);
  });

  it("returns [] when there is no control", () => {
    expect(reasoningOptions({ graded: [] })).toEqual([]);
  });
});

describe("normalizeReasoningEffort", () => {
  it("keeps a value the model offers", () => {
    expect(normalizeReasoningEffort("high", ["low", "high", "max"])).toBe(
      "high",
    );
  });

  it("snaps to the nearest offered level, preferring the higher on a tie", () => {
    // stored global default `medium`, model offers max/high/low/none
    expect(
      normalizeReasoningEffort("medium", ["none", "low", "high", "max"]),
    ).toBe("high");
    // `minimal` snaps up to `low`
    expect(normalizeReasoningEffort("minimal", ["low", "high"])).toBe("low");
  });

  it("returns undefined when nothing is offered", () => {
    expect(normalizeReasoningEffort("high", [])).toBeUndefined();
  });
});

describe("reasoningParams", () => {
  it("maps none to toggle-off and reasoning_effort none when available", () => {
    const traits: ReasoningTraits = {
      graded: ["max", "high", "low", "none"],
      toggle: "thinking",
    };
    expect(reasoningParams(traits, "none")).toEqual({
      chat_template_kwargs: { thinking: false },
      reasoning_effort: "none",
    });
  });

  it("turns the toggle on and forwards a supported level", () => {
    const traits: ReasoningTraits = {
      graded: ["low", "medium", "xhigh"],
      toggle: "enable_thinking",
    };
    expect(reasoningParams(traits, "xhigh")).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: "xhigh",
    });
  });

  it("omits a level the model does not declare", () => {
    expect(reasoningParams(graded(["low", "high"]), "minimal")).toEqual({});
  });

  it("returns {} when there is no control", () => {
    expect(reasoningParams({ graded: [] }, "high")).toEqual({});
  });
});
