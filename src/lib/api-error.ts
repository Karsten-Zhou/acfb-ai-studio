import { apiErrorBodySchema, type ApiErrorCode } from "@shared/errors";

/** A failed API response, reduced to what the client needs. */
export interface ApiError {
  /** Message to show the user. Always non-empty. */
  message: string;
  status: number;
  /** Machine-readable marker, when the server supplied one. */
  code?: ApiErrorCode;
}

/**
 * Read the reason out of a failed response, validated against
 * `apiErrorBodySchema`. Never throws: any non-JSON body still yields a usable
 * message.
 */
export async function readApiError(res: Response): Promise<ApiError> {
  const status = res.status;
  const raw = await res.text().catch(() => "");

  if (raw) {
    try {
      const parsed = apiErrorBodySchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        const { error, code } = parsed.data;
        return { message: error, status, ...(code ? { code } : {}) };
      }
    } catch {
      // Not JSON (an HTML error page, a proxy response): fall through and show
      // the body itself rather than losing the only clue we have.
    }
    return { message: raw.slice(0, 300), status };
  }

  return { message: `Request failed (${status}).`, status };
}
