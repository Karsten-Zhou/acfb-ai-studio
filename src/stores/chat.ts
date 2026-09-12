// Client-side chat state: the conversation tree, the composer options and the
// streaming pipeline.
//
// This is a Pinia store (not a composable) because the same state is read from
// several views and outlives any of them: the sidebar renders the conversation
// list, `ChatView` renders the active thread, and the sync engine serializes it
// all. The HTTP/stream parsing stays here too — it is this store's own business
// logic, and every entry point funnels through it.

import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { throttleFilter, useStorage } from "@vueuse/core";
import { STORAGE_KEY } from "@shared/chat";
import type { ChatRequest } from "@shared/api";
import { FREE_TEXT_GENERATION_MODELS } from "@shared/generated/models";
import { defaultOptions, setDefaults } from "@/composables/chat-defaults";
import { useSyncStore } from "@/stores/sync";
import { readApiError } from "@/lib/api-error";
import { t } from "@/lib/i18n";
import { toastError } from "@/lib/toast";
import {
  activeThread,
  childrenOf,
  deepestLeaf,
  nodeById,
  pathTo,
} from "@/lib/conversation-tree";
import type {
  ChatMessage,
  Conversation,
  GenerationParams,
  ReasoningEffort,
  WireChatMessage,
} from "@shared/chat";

/**
 * Resolve the initial model: the persisted default, else the catalogue default,
 * so a fresh install never starts with no model selected.
 */
function resolveInitialModel(): string {
  const stored = defaultOptions.model;
  if (stored) return stored;
  return FREE_TEXT_GENERATION_MODELS[0]?.name ?? "";
}

export const useChatStore = defineStore("chat", () => {
  const sync = useSyncStore();

  /**
   * A reactive ref backed by localStorage. The `throttleFilter(300)` ensures
   * that rapid mutations during streaming are batched into at most one write
   * every 300ms.
   */
  const conversations = useStorage<Conversation[]>(STORAGE_KEY, [], undefined, {
    eventFilter: throttleFilter(300),
  });
  const activeId = ref<string | null>(null);
  const model = ref(resolveInitialModel());
  const reasoningEffort = ref<ReasoningEffort>(defaultOptions.reasoningEffort);
  const params = ref<GenerationParams>({ ...defaultOptions.params });
  /** Whether a stream is currently in flight (disables send button). */
  const streaming = ref(false);

  /** In-flight request, so the user can stop it. Transient, not app state. */
  let activeController: AbortController | null = null;

  /**
   * Older builds persisted a blank "New chat" thread as soon as the user clicked
   * "New Conversation". A thread with no messages is a draft, not history, so
   * drop any that were persisted (and tombstone them so another device's copy
   * goes too).
   */
  function dropPersistedBlankThreads(): void {
    const blank = conversations.value.filter((c) => c.messages.length === 0);
    if (blank.length === 0) return;
    for (const conv of blank) sync.recordDeletion(conv.id);
    conversations.value = conversations.value.filter(
      (c) => c.messages.length > 0,
    );
  }

  dropPersistedBlankThreads();

  // Remember the composer options as the defaults for new conversations.
  watch(
    [model, reasoningEffort, params],
    () => {
      setDefaults({
        model: model.value,
        reasoningEffort: reasoningEffort.value,
        params: { ...params.value },
      });
    },
    { flush: "sync", deep: true },
  );

  // -------------------------------------------------------------------------
  // Conversation helpers
  // -------------------------------------------------------------------------

  function activeConversation(): Conversation | undefined {
    return conversations.value.find((c) => c.id === activeId.value);
  }

  function conversationById(id: string): Conversation | undefined {
    return conversations.value.find((c) => c.id === id);
  }

  /**
   * Start a new, empty thread.
   * No conversation is created yet: an empty thread is represented by the absence
   * of an active conversation, and only becomes real once the first message is
   * sent (see `sendMessage`). This keeps blank threads out of local storage and,
   * more importantly, out of the synced history.
   */
  function startNewConversation(): void {
    activeId.value = null;
  }

  /** Create and select a real conversation. Only called once there is content. */
  function createConversation(): Conversation {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: t("chat.newChat"),
      model: model.value,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      leafId: null,
    };
    conversations.value.unshift(conv);
    activeId.value = conv.id;
    return conv;
  }

  function deleteConversation(id: string): void {
    conversations.value = conversations.value.filter((c) => c.id !== id);
    // Tombstone it so another device that still holds a copy doesn't resurrect it.
    sync.recordDeletion(id);
    if (activeId.value === id) {
      activeId.value = conversations.value[0]?.id ?? null;
    }
  }

  function renameConversation(id: string, title: string): void {
    const conv = conversationById(id);
    if (conv) conv.title = title;
  }

  function switchConversation(id: string): void {
    activeId.value = id;
  }

  function stopStreaming(): void {
    activeController?.abort();
    streaming.value = false;
  }

  function touch(conv: Conversation): void {
    conv.updatedAt = Date.now();
  }

  function createNode(
    role: ChatMessage["role"],
    content: string,
    parentId: string | null,
  ): ChatMessage {
    return {
      id: crypto.randomUUID(),
      parentId,
      role,
      content,
      createdAt: Date.now(),
    };
  }

  // -------------------------------------------------------------------------
  // Streaming core
  // -------------------------------------------------------------------------

  /**
   * Stream an assistant reply as a child of `replyTo`. Every entry point —
   * new message, edit-and-resend, retry — funnels through here, so there is
   * exactly one streaming code path. The prompt is the tree path root → replyTo.
   *
   * If `replyTo` already carries a childless failed placeholder (error, no
   * content), that node is reused instead of stacking another error sibling —
   * retrying a failed turn replaces the error in place, like ChatGPT.
   */
  async function streamAssistantReply(
    conv: Conversation,
    replyTo: ChatMessage,
  ): Promise<void> {
    const conversationId = conv.id;
    conv.model = model.value;

    let resolved = reusableFailedChild(conv, replyTo);
    if (!resolved) {
      resolved = createNode("assistant", "", replyTo.id);
      conv.messages.push(resolved);
    }
    const assistant: ChatMessage = resolved;

    delete assistant.error;
    delete assistant.reasoning;
    assistant.content = "";
    replyTo.activeChildId = assistant.id;
    conv.leafId = assistant.id;
    touch(conv);

    const requestMessages = toWireMessages(conv, replyTo);

    streaming.value = true;
    const controller = new AbortController();
    activeController = controller;

    // Re-resolve by id on every delta: adopting remote state (or a delete) can
    // replace the conversation objects while the stream is running.
    function currentTurn() {
      const live = conversationById(conversationId);
      return { live, msg: live?.messages.find((m) => m.id === assistant.id) };
    }

    try {
      await streamChat(
        {
          conversationId,
          model: model.value,
          messages: requestMessages,
          params: params.value,
          reasoningEffort: reasoningEffort.value,
        },
        (delta) => {
          const { msg } = currentTurn();
          if (!msg) return;
          if (delta.reasoning) {
            msg.reasoning = (msg.reasoning ?? "") + delta.reasoning;
          }
          if (delta.content) {
            msg.content = (msg.content ?? "") + delta.content;
          }
        },
        controller.signal,
      );

      const { live, msg } = currentTurn();
      if (msg) msg.content = msg.content.trimEnd();
      if (live) touch(live);
    } catch (err) {
      const { live, msg } = currentTurn();
      // Keep the failed turn in the tree rather than deleting it: this
      // preserves user/assistant alternation for both the UI and the next
      // request, and lets the user see — and retry — exactly what failed,
      // like ChatGPT's error bubble.
      if (live && msg && !msg.content) {
        msg.error = describeChatError(err);
        touch(live);
      }
      reportChatError(err);
    } finally {
      activeController = null;
      streaming.value = false;
    }
  }

  /**
   * A failed assistant child of `parent` that may be retried in place: flagged
   * with an error, produced no content, and has no children of its own
   * (retrying a node that already has a continuation would orphan it, so those
   * get a fresh sibling instead).
   */
  function reusableFailedChild(
    conv: Conversation,
    parent: ChatMessage,
  ): ChatMessage | undefined {
    const kids = childrenOf(conv, parent.id);
    const candidate =
      kids.find((k) => k.id === parent.activeChildId) ?? kids[kids.length - 1];
    if (!candidate) return undefined;
    if (!candidate.error || candidate.content) return undefined;
    if (childrenOf(conv, candidate.id).length > 0) return undefined;
    return candidate;
  }

  /**
   * Build the wire payload for a reply to `upTo`: the tree path, minus empty
   * and failed turns (they carry no content), with any resulting consecutive
   * same-role turns coalesced. This guarantees a strictly alternating
   * user/assistant sequence for models that require it — e.g. after a failed
   * turn, the next prompt would otherwise sit directly on top of the original.
   */
  function toWireMessages(
    conv: Conversation,
    upTo: ChatMessage,
  ): WireChatMessage[] {
    const out: WireChatMessage[] = [];
    for (const m of pathTo(conv, upTo)) {
      if (!m.content || m.error) continue;
      const last = out[out.length - 1];
      if (last && last.role === m.role) {
        last.content += `\n\n${m.content}`;
        continue;
      }
      out.push({
        role: m.role,
        content: m.content,
        ...(m.reasoning ? { reasoning: m.reasoning } : {}),
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Entry points (send / edit / retry / navigate)
  // -------------------------------------------------------------------------

  /** Send from the composer: continues the active branch or starts a new one. */
  async function sendMessage(content: string): Promise<void> {
    if (streaming.value) return;
    const conv = activeConversation() ?? createConversation();

    const userMsg = createNode("user", content, conv.leafId);
    const parent = nodeById(conv, conv.leafId);
    if (parent) parent.activeChildId = userMsg.id;
    conv.messages.push(userMsg);
    conv.leafId = userMsg.id;
    touch(conv);

    if (conv.messages.length === 1) {
      conv.title = content.slice(0, 40) || t("chat.newChat");
    }

    await streamAssistantReply(conv, userMsg);
  }

  /**
   * Edit the user message `messageId`: create a sibling variant with the new
   * content and generate a fresh reply under it. The original branch (and its
   * whole subtree) is preserved and stays reachable via sibling navigation.
   */
  async function editAndResend(
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    if (streaming.value) return;
    const conv = conversationById(conversationId);
    if (!conv) throw new Error(t("chat.conversationNotFound"));
    const original = nodeById(conv, messageId);
    if (!conv || !original || original.role !== "user") return;
    const trimmed = content.trim();
    if (!trimmed) return;

    const sibling = createNode("user", trimmed, original.parentId);
    conv.messages.push(sibling);
    const parent = nodeById(conv, original.parentId);
    if (parent) parent.activeChildId = sibling.id;
    conv.leafId = sibling.id;
    touch(conv);

    await streamAssistantReply(conv, sibling);
  }

  /**
   * "Try again" on the assistant message `messageId`: create a sibling reply
   * under the same user node and stream it. The old reply stays as a sibling.
   */
  async function retryAt(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    if (streaming.value) return;
    const conv = conversationById(conversationId);
    if (!conv) throw new Error(t("chat.conversationNotFound"));
    const original = nodeById(conv, messageId);
    if (!conv || !original || original.role !== "assistant") return;
    const prompt = nodeById(conv, original.parentId);
    if (!prompt || prompt.role !== "user") return;

    await streamAssistantReply(conv, prompt);
  }

  /**
   * Switch to the previous/next sibling of `messageId` (◀ ▶ navigation).
   * The leaf lands on the remembered deepest node of the target sibling.
   */
  function switchSibling(
    conversationId: string,
    messageId: string,
    direction: -1 | 1,
  ): void {
    if (streaming.value) return;
    const conv = conversationById(conversationId);
    if (!conv) throw new Error(t("chat.conversationNotFound"));
    const node = nodeById(conv, messageId);
    if (!conv || !node) return;

    const siblings = childrenOf(conv, node.parentId);
    const idx = siblings.findIndex((m) => m.id === node.id);
    const target = siblings[idx + direction];
    if (!target) return;

    const parent = nodeById(conv, node.parentId);
    if (parent) parent.activeChildId = target.id;
    conv.leafId = deepestLeaf(conv, target).id;
    touch(conv);
  }

  // -------------------------------------------------------------------------
  // Retry / regenerate conveniences
  // -------------------------------------------------------------------------

  /**
   * Retry the failed last turn (error-toast action). The failed prompt is still
   * the last user node of the active thread — the empty assistant placeholder
   * was already removed on failure — so this hangs a fresh reply off it without
   * creating duplicate user variants.
   */
  async function retryLast(): Promise<void> {
    if (streaming.value) return;
    const conv = activeConversation();
    if (!conv) return;
    const thread = activeThread(conv);
    for (let i = thread.length - 1; i >= 0; i--) {
      if (thread[i].role === "user") {
        await streamAssistantReply(conv, thread[i]);
        return;
      }
    }
  }

  /** Regenerate the most recent assistant reply of the active thread. */
  async function regenerate(): Promise<void> {
    const conv = activeConversation();
    if (!conv) return;
    const thread = activeThread(conv);
    const last = thread[thread.length - 1];
    if (!last || last.role !== "assistant" || thread.length < 2) return;
    await retryAt(conv.id, last.id);
  }

  /** Human-readable reason for a failed or stopped stream. */
  function describeChatError(err: unknown): string {
    if (err instanceof DOMException && err.name === "AbortError") {
      return t("common.stoppedByYou");
    }
    // `fetch` rejects with a TypeError when the request never reached the
    // server; the browser's own "Failed to fetch" is not actionable, so say
    // something useful instead.
    const offline =
      err instanceof TypeError ||
      (err instanceof Error && err.name === "TypeError");
    return offline
      ? t("chat.offline")
      : err instanceof Error
        ? err.message
        : String(err);
  }

  /**
   * Report a failed turn.
   * One-shot: the failure is shown once and forgotten, so nothing is kept in
   * store state. The failed bubble itself stays in the thread (see
   * `streamAssistantReply`).
   */
  function reportChatError(err: unknown): void {
    const message = describeChatError(err);
    if (err instanceof DOMException && err.name === "AbortError") {
      toastError(t("common.stopped"), message, { duration: 4_000 });
      return;
    }
    toastError(t("chat.failedTitle"), message);
  }

  return {
    conversations,
    activeId,
    model,
    reasoningEffort,
    params,
    streaming,
    startNewConversation,
    createConversation,
    deleteConversation,
    renameConversation,
    switchConversation,
    stopStreaming,
    sendMessage,
    editAndResend,
    retryAt,
    switchSibling,
    retryLast,
    regenerate,
  };
});

// ---------------------------------------------------------------------------
// SSE stream helper
// ---------------------------------------------------------------------------

async function streamChat(
  req: ChatRequest,
  onDelta: (delta: { content?: string; reasoning?: string }) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok || !res.body) {
    // The server's own reason (quota, NSFW, ...) is more useful than a status.
    throw new Error((await readApiError(res)).message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  function extractDelta(json: unknown): {
    content?: string;
    reasoning?: string;
  } {
    if (typeof json === "string") return { content: json };
    const obj = json as {
      response?: string;
      choices?: Array<{
        delta?: { content?: string; reasoning_content?: string };
      }>;
    };
    const choice = obj.choices?.[0]?.delta;
    const fromChoices = choice?.content;
    const reasoning = choice?.reasoning_content;
    const content =
      typeof fromChoices === "string" && fromChoices !== ""
        ? fromChoices
        : typeof obj.response === "string"
          ? obj.response
          : undefined;
    return { content, reasoning };
  }

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: true });
    let nlIdx;
    while ((nlIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
      buffer = buffer.slice(nlIdx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trimStart();
      if (!payload) continue;
      try {
        const delta = extractDelta(JSON.parse(payload));
        if (delta.content || delta.reasoning) onDelta(delta);
      } catch {
        // Ignore `data: [DONE]` and any non-JSON sentinel.
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing.startsWith("data:")) {
    const payload = trailing.slice(5).trimStart();
    if (payload) {
      try {
        const delta = extractDelta(JSON.parse(payload));
        if (delta.content || delta.reasoning) onDelta(delta);
      } catch {
        /* ignore */
      }
    }
  }
}
