// Build the ordered render timeline for an assistant reply.
//
// `message.segments` is the authoritative, in-order record of what the model
// produced: reasoning and answer text interleaved with tool calls. It is always
// present (see `shared/chat-migration.ts` for how legacy data is upgraded), so
// this module assumes the current format and reads order from `segments` alone.
//
// A reply splits into two regions at the first answer-content segment:
//   - reasoning: the leading reasoning text and any tool calls made while still
//     thinking (these belong *inside* the reasoning collapsible);
//   - body: the answer text and any later tool calls, in order.
//
// A leading tool call with no reasoning text is not a "thought"; it is moved to
// the body so it is never hidden behind a Reasoning toggle.
//
// Kept pure and framework-free so the ordering is unit-testable.

import type { ChatMessage, ToolCall } from "@shared/chat";

/** One renderable item of the timeline. */
export type TimelineItem =
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "tools"; calls: ToolCall[] };

/**
 * The reply fields the timeline is built from. `segments` is required — the new
 * format — while the flat projections are optional conveniences.
 */
type ReplyShape = Pick<ChatMessage, "segments"> &
  Partial<Pick<ChatMessage, "content" | "reasoning" | "toolCalls">>;

/** Append text, coalescing into the previous segment when it is the same kind. */
function pushText(
  list: TimelineItem[],
  type: "reasoning" | "content",
  text: string,
): void {
  if (!text) return;
  const last = list[list.length - 1];
  if (last?.type === type) {
    last.text += text;
    return;
  }
  list.push({ type, text });
}

/** Append a call, coalescing into the previous tool group when possible. */
function pushTool(list: TimelineItem[], call: ToolCall): void {
  const last = list[list.length - 1];
  if (last?.type === "tools") last.calls.push(call);
  else list.push({ type: "tools", calls: [call] });
}

/** Split a reply into its reasoning region and answer body, in order. */
export function buildAssistantParts(message: ReplyShape): {
  reasoning: TimelineItem[];
  body: TimelineItem[];
} {
  const byId = new Map(
    (message.toolCalls ?? []).map((call) => [call.id, call]),
  );

  const reasoning: TimelineItem[] = [];
  const body: TimelineItem[] = [];
  let inBody = false;

  for (const segment of message.segments) {
    if (segment.type === "content") {
      inBody = true;
      pushText(body, "content", segment.text);
    } else if (segment.type === "reasoning") {
      // Reasoning always belongs to the reasoning region. A stray post-answer
      // reasoning segment (rare) is kept there rather than leaked into the
      // answer as ordinary prose.
      pushText(reasoning, "reasoning", segment.text);
    } else {
      const call = byId.get(segment.id);
      if (!call) continue;
      // Tool calls made before any answer text belong to the reasoning flow;
      // later ones sit in the answer body.
      pushTool(inBody ? body : reasoning, call);
    }
  }

  // A leading tool call with no reasoning text is part of the answer flow, not
  // a hidden thought: move it out of the reasoning region.
  if (!reasoning.some((item) => item.type === "reasoning")) {
    body.unshift(...reasoning);
    reasoning.length = 0;
  }

  return { reasoning, body };
}
