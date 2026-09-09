import { describe, expect, it, vi } from "vitest";
import { CORRUPT_STATE } from "@shared/errors";
import { errorResponse, upstreamError, UserFacingError } from "./errors";

describe("upstreamError", () => {
  it("surfaces an inference error that carries no numeric code", async () => {
    // Regression: `InferenceUpstreamError` (e.g. an NSFW prompt) has no `code`,
    // so sniffing the error's shape downgraded it to "The request failed."
    class InferenceUpstreamError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "InferenceUpstreamError";
      }
    }

    const res = errorResponse(
      upstreamError(
        new InferenceUpstreamError("8007: Input prompt contains NSFW content."),
      ),
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "8007: Input prompt contains NSFW content.",
    });
  });

  it("keeps an upstream status that is a valid one", async () => {
    const err = Object.assign(new Error("Rate limited"), { status: 429 });

    const res = errorResponse(upstreamError(err));

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "Rate limited" });
  });

  it("leaves an already user-facing error untouched", () => {
    const original = new UserFacingError("No image field");

    expect(upstreamError(original)).toBe(original);
  });
});

describe("errorResponse", () => {
  it("hides unexpected failures", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("internal connection string"));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "The request failed.",
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("passes a user-facing status and code through", async () => {
    const res = errorResponse(
      new UserFacingError("Reset it to continue.", {
        status: 503,
        code: CORRUPT_STATE,
      }),
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Reset it to continue.",
      code: CORRUPT_STATE,
    });
  });
});
