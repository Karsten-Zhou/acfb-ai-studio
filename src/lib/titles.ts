import type { ChatRequest } from "@shared/api";

/** Create a stable, readable default title from user-entered text. */
export function autoTitle(text: string, maxLength = 40): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Ask the selected text model for a short title, returning null on failure. */
export async function generateTitle(
  model: string,
  subject: string,
): Promise<string | null> {
  const request: ChatRequest = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Create a concise title for the user's content. Return only the title, with no quotes, markdown, or explanation. Use at most 8 words in user's language.",
      },
      { role: "user", content: subject },
    ],
    params: { stream: false },
    reasoningEffort: "off",
  };

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { content?: string };
    const title = data.content?.replace(/[\r\n]+/g, " ").trim();
    return title ? autoTitle(title) : null;
  } catch {
    return null;
  }
}
