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
import { STORAGE_KEY, streamEventSchema } from "@shared/chat";
import type { ChatRequest } from "@shared/api";
import { FREE_TEXT_GENERATION_MODELS } from "@shared/generated/models";
import { defaultOptions, setDefaults } from "@/composables/chat-defaults";
import { useSyncStore } from "@/stores/sync";
import { readApiError } from "@/lib/api-error";
import { t } from "@/lib/i18n";
import { autoTitle, generateTitle } from "@/lib/titles";
import {
  activeThread,
  childrenOf,
  deepestLeaf,
  nodeById,
  pathTo,
} from "@/lib/conversation-tree";
import type {
  Attachment,
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
  /**
   * Conversations whose AI title is being generated. The sidebar shimmers those
   * titles, so a placeholder does not read as a finished title.
   */
  const titlesPendingIds = ref(new Set<string>());

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
      titleSource: "fallback",
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
    if (!conv) return;
    const nextTitle = autoTitle(title);
    if (!nextTitle) return;
    conv.title = nextTitle;
    conv.titleSource = "user";
    touch(conv);
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
    attachments?: Attachment[],
  ): ChatMessage {
    return {
      id: crypto.randomUUID(),
      parentId,
      role,
      content,
      createdAt: Date.now(),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
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
  ): Promise<boolean> {
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

    // The user's global system prompt (settings) leads every request. It is
    // prepended here — not in `toWireMessages` — so it is never coalesced with
    // a same-role turn and stays the first thing the model sees.
    const systemPrompt = defaultOptions.systemPrompt?.trim();
    if (systemPrompt) {
      requestMessages.unshift({ role: "system", content: systemPrompt });
    }

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
      return true;
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
      return false;
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
      // A turn with neither text nor attachments carries nothing; a failed
      // turn is dropped entirely.
      if (m.error) continue;
      const hasAttachments = (m.attachments?.length ?? 0) > 0;
      if (!m.content && !hasAttachments) continue;

      const last = out[out.length - 1];
      if (last && last.role === m.role) {
        last.content += m.content ? `\n\n${m.content}` : "";
        if (hasAttachments) {
          last.attachments = [...(last.attachments ?? []), ...m.attachments!];
        }
        continue;
      }
      out.push({
        role: m.role,
        content: m.content,
        ...(m.reasoning ? { reasoning: m.reasoning } : {}),
        ...(hasAttachments ? { attachments: m.attachments } : {}),
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Entry points (send / edit / retry / navigate)
  // -------------------------------------------------------------------------

  /**
   * Ask the model for a title and apply it, marking the conversation as pending
   * for the whole round trip so the sidebar shimmers its placeholder meanwhile.
   *
   * A title describes the user's text, not the reply, so this is deliberately
   * able to run while the reply is still streaming — callers fire and forget it.
   */
  async function applyGeneratedTitle(
    conversationId: string,
    subject: string,
  ): Promise<void> {
    titlesPendingIds.value.add(conversationId);
    try {
      const title = await generateTitle(model.value, subject);
      // Re-resolve before writing, like the stream deltas above: adopting
      // remote state replaces the conversation objects, so the conversation
      // looked up earlier may be detached by now.
      const live = conversationById(conversationId);
      if (title && live && live.titleSource !== "user") {
        live.title = title;
        live.titleSource = "ai";
        touch(live);
      }
    } finally {
      titlesPendingIds.value.delete(conversationId);
    }
  }

  /** Send from the composer: continues the active branch or starts a new one. */
  async function sendMessage(
    content: string,
    attachments?: Attachment[],
  ): Promise<void> {
    if (streaming.value) return;
    const conv = activeConversation() ?? createConversation();

    const userMsg = createNode("user", content, conv.leafId, attachments);
    const parent = nodeById(conv, conv.leafId);
    if (parent) parent.activeChildId = userMsg.id;
    conv.messages.push(userMsg);
    conv.leafId = userMsg.id;
    touch(conv);

    if (conv.messages.length === 1) {
      conv.title = autoTitle(content) || t("chat.newChat");
      conv.titleSource = "fallback";
      // Naming a conversation does not depend on the reply, so the title is
      // requested alongside the stream rather than after it — unless the user
      // disabled automatic title generation in the settings. Attachments alone
      // (no text) give the title generator nothing to work with.
      if (defaultOptions.autoTitle !== false && content) {
        void applyGeneratedTitle(conv.id, content);
      }
    }

    await streamAssistantReply(conv, userMsg);
  }

  /**
   * Edit the user message `messageId`: create a sibling variant with the new
   * content and generate a fresh reply under it. The original branch (and its
   * whole subtree) is preserved and stays reachable via sibling navigation.
   *
   * Attachments carry over to the edited variant, since editing is for the
   * text prompt; removing or adding media is done by sending a new message.
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

    const sibling = createNode(
      "user",
      trimmed,
      original.parentId,
      original.attachments,
    );
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

  return {
    conversations,
    activeId,
    model,
    reasoningEffort,
    params,
    streaming,
    titlesPendingIds,
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

  // Handle one canonical `streamEventSchema` event.
  function handlePayload(payload: string): void {
    if (!payload) return;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      // Ignore any non-JSON sentinel.
      return;
    }
    const parsed = streamEventSchema.safeParse(json);
    if (!parsed.success) return;

    const event = parsed.data;
    if (event.type === "error") {
      throw new Error(event.message);
    }
    if (event.type === "delta" && (event.delta || event.reasoning)) {
      onDelta({ content: event.delta, reasoning: event.reasoning });
    }
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
      handlePayload(line.slice(5).trimStart());
    }
  }

  const trailing = buffer.trim();
  if (trailing.startsWith("data:")) {
    handlePayload(trailing.slice(5).trimStart());
  }
}
