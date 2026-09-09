// The single error path for every API route.
//
// A route either throws a `UserFacingError` — a message written for the user —
// or it fails unexpectedly, in which case the reason is logged and replaced with
// a generic message so internal details never leak.
//
// Upstream calls (`env.AI.run`, KV, ...) are marked at the call site with
// `upstreamError()`. That is the only place that knows where a failure came
// from, and Cloudflare's own error classes are inconsistent — `AiError` carries
// a numeric `code`, `InferenceUpstreamError` does not — so the error's shape
// cannot be sniffed reliably after the fact.

import type { ApiErrorBody, ApiErrorCode } from "@shared/errors";

/** An error whose message was written for the user and may be returned as-is. */
export class UserFacingError extends Error {
  status: number;
  code?: ApiErrorCode;

  constructor(
    message: string,
    options: { status?: number; code?: ApiErrorCode } = {},
  ) {
    super(message);
    this.name = "UserFacingError";
    this.status = options.status ?? 502;
    this.code = options.code;
  }
}

/**
 * Mark a thrown upstream call as something the user should see.
 *
 * Anything thrown by an external call is actionable (bad input, quota, model
 * unavailable), so its message is forwarded. An error that is already
 * user-facing is returned untouched so the mark is idempotent.
 */
export function upstreamError(err: unknown): UserFacingError {
  if (err instanceof UserFacingError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: unknown } | null)?.status;

  return new UserFacingError(message || "The request failed.", {
    status: httpStatus(status),
  });
}

/**
 * Turn a thrown value into the single `{ error, code? }` response shape.
 *
 * Only deliberately user-facing errors are shown; everything else is logged and
 * reported generically.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof UserFacingError) {
    const body: ApiErrorBody = err.code
      ? { error: err.message, code: err.code }
      : { error: err.message };
    return Response.json(body, { status: httpStatus(err.status) });
  }

  console.error("Unhandled API error:", err);
  return Response.json({ error: "The request failed." }, { status: 502 });
}

/** Only 4xx/5xx are meaningful statuses; anything else becomes a 502. */
function httpStatus(status: unknown): number {
  return typeof status === "number" && status >= 400 && status <= 599
    ? status
    : 502;
}
