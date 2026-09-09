// Pure helpers over the conversation message tree. No framework imports:
// keep this module trivially testable.
import type { ChatMessage, Conversation } from "@shared/chat";

export function nodeById(
  conv: Conversation,
  id: string | null | undefined,
): ChatMessage | undefined {
  if (!id) return undefined;
  return conv.messages.find((m) => m.id === id);
}

/** Direct children of a node (roots when `parentId` is null), oldest first. */
export function childrenOf(
  conv: Conversation,
  parentId: string | null,
): ChatMessage[] {
  return conv.messages
    .filter((m) => m.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Path from the root to `node` (inclusive). */
export function pathTo(
  conv: Conversation,
  node: ChatMessage | undefined,
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of conv.messages) byId.set(m.id, m);

  const path: ChatMessage[] = [];
  let cursor = node;
  while (cursor) {
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}

/**
 * The currently active thread (root → leaf). If `leafId` is missing/stale,
 * recover by following the remembered active-child chain from the root.
 */
export function activeThread(conv: Conversation): ChatMessage[] {
  const leaf = nodeById(conv, conv.leafId);
  if (leaf) return pathTo(conv, leaf);

  const path: ChatMessage[] = [];
  let node: ChatMessage | undefined = childrenOf(conv, null)[0];
  while (node) {
    path.push(node);
    // Explicitly type to break TS circular inference
    const activeChildId: string | undefined = node.activeChildId;
    const kids = childrenOf(conv, node.id);
    node = kids.find((k) => k.id === activeChildId) ?? kids[0];
  }
  return path;
}

/**
 * Deepest node of the subtree rooted at `from`, following the remembered
 * active child at each level (falls back to the oldest child). Used when
 * switching siblings so you land back on the sub-branch you last viewed.
 */
export function deepestLeaf(
  conv: Conversation,
  from: ChatMessage,
): ChatMessage {
  let node: ChatMessage = from;
  for (;;) {
    const kids = childrenOf(conv, node.id);
    if (kids.length === 0) return node;
    // Explicitly type to break TS circular inference
    const activeChildId: string | undefined = node.activeChildId;
    node = kids.find((k) => k.id === activeChildId) ?? kids[0];
  }
}
