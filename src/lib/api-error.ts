import type { ApiErrorBody, ApiErrorCode } from "@shared/errors";

/** A failed API response, reduced to what the client needs. */
export interface ApiError {
  /** Message to show the user. Always non-empty. */
  message: string;
  status: number;
  /** Machine-readable marker, when the server supplied one. */
  code?: ApiErrorCode;
}

/**
 * Read the reason out of a failed response.
 *
 * Never throws: a response that is not the expected JSON shape still yields a
 * usable message, so the UI never degrades to a bare "Request failed (500)".
 */
export async function readApiError(res: Response): Promise<ApiError> {
  const status = res.status;
  const raw = await res.text().catch(() => "");

  if (raw) {
    try {
      const body = JSON.parse(raw) as Partial<ApiErrorBody>;
      if (typeof body.error === "string" && body.error) {
        return { message: body.error, status, code: body.code };
      }
    } catch {
      // Not JSON (an HTML error page, a proxy response): fall through and show
      // the body itself rather than losing the only clue we have.
    }
    return { message: raw.slice(0, 300), status };
  }

  return { message: `Request failed (${status}).`, status };
}
