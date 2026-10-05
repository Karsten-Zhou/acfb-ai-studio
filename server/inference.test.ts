import { describe, expect, it } from "vitest";
import { readInferenceResult } from "./inference";

describe("readInferenceResult", () => {
  it("reads the legacy top-level `response` of prompt-input models", () => {
    expect(
      readInferenceResult({ response: "Hallo", usage: { total_tokens: 7 } }),
    ).toEqual({ content: "Hallo", reasoning: "" });
  });

  it("reads the OpenAI-style message of chat models", () => {
    expect(
      readInferenceResult({
        choices: [{ message: { role: "assistant", content: "Hallo" } }],
      }),
    ).toEqual({ content: "Hallo", reasoning: "" });
  });

  it("prefers a top-level `response` over an empty message", () => {
    expect(
      readInferenceResult({
        response: "Hallo",
        choices: [{ message: { content: "" } }],
      }),
    ).toEqual({ content: "Hallo", reasoning: "" });
  });

  it("collects reasoning under either spelling", () => {
    expect(
      readInferenceResult({
        choices: [{ message: { content: "Hallo", reasoning: "weil" } }],
      }),
    ).toEqual({ content: "Hallo", reasoning: "weil" });

    expect(
      readInferenceResult({
        choices: [{ message: { content: "Hallo", reasoning_content: "weil" } }],
      }),
    ).toEqual({ content: "Hallo", reasoning: "weil" });
  });

  it("passes a bare string answer through", () => {
    expect(readInferenceResult("Hallo")).toEqual({
      content: "Hallo",
      reasoning: "",
    });
  });

  it("falls back to empty strings for a payload that carries neither", () => {
    expect(
      readInferenceResult({ choices: [{ message: { content: null } }] }),
    ).toEqual({ content: "", reasoning: "" });
    expect(readInferenceResult(undefined)).toEqual({
      content: "",
      reasoning: "",
    });
  });
});
