import { titleResponseSchema } from "@shared/api";

/** Create a stable, readable default title from user-entered text. */
export function autoTitle(text: string, maxLength = 40): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Ask `POST /api/chat/title` for a short title. Returns null on any failure:
 * every caller has a text-based fallback, so the thread still gets a title —
 * but the reason for the miss is logged, because it usually means an expired
 * session or a model that rejected the request.
 */
export async function generateTitle(
  model: string,
  subject: string,
): Promise<string | null> {
  try {
    const response = await fetch("/api/chat/title", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, subject }),
    });
    if (!response.ok) {
      console.warn(
        `[title] request failed with ${response.status}, using the text fallback`,
      );
      return null;
    }

    const parsed = titleResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn(
        "[title] unexpected response shape, using the text fallback",
        parsed.error,
      );
      return null;
    }

    // Truncate for display if a model ignored the length instruction.
    return autoTitle(parsed.data.title);
  } catch (error) {
    console.warn("[title] request threw, using the text fallback", error);
    return null;
  }
}
