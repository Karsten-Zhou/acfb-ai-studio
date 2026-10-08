import { titleResponseSchema } from "@shared/api";

/** Create a stable, readable default title from user-entered text. */
export function autoTitle(text: string, maxLength = 40): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Ask `POST /api/chat/title` for a short title; returns null on failure. */
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
    if (!response.ok) return null;

    const parsed = titleResponseSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    // Truncate for display if a model ignored the length instruction.
    return autoTitle(parsed.data.title);
  } catch {
    return null;
  }
}
