<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Sparkles } from "@lucide/vue";
import type { ChatMessage as ChatMessageType } from "@shared/chat";
import { useChatStore } from "@/stores/chat";
import { activeThread, childrenOf } from "@/lib/conversation-tree";
import { FREE_TEXT_GENERATION_MODELS } from "@shared/generated/models";
import ChatMessage from "@/components/chat/ChatMessage.vue";
import ChatInput from "@/components/chat/ChatInput.vue";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import AppHeader from "@/components/AppHeader.vue";

const { t } = useI18n({ useScope: "global" });
const chatStore = useChatStore();
const models = FREE_TEXT_GENERATION_MODELS;

const activeConv = computed(() =>
  chatStore.conversations.find((c) => c.id === chatStore.activeId),
);

/**
 * The visible branch (root → leaf), pre-joined with each node's sibling
 * position so `ChatMessage` can render ◀ 2/3 ▶ without knowing about the tree.
 */
const thread = computed(() => {
  const conv = activeConv.value;
  if (!conv) {
    return [] as Array<{
      message: ChatMessageType;
      siblingIndex: number;
      siblingCount: number;
    }>;
  }
  return activeThread(conv).map((message) => {
    const siblings = childrenOf(conv, message.parentId);
    return {
      message,
      siblingIndex: siblings.findIndex((s) => s.id === message.id) + 1,
      siblingCount: siblings.length,
    };
  });
});

const lastIndex = computed(() => thread.value.length - 1);

async function handleSend(content: string) {
  await chatStore.sendMessage(content);
}

function handleStop() {
  chatStore.stopStreaming();
}

function handleEdit(messageId: string, content: string) {
  const conv = activeConv.value;
  if (!conv) return;
  void chatStore.editAndResend(conv.id, messageId, content);
}

function handleRetry(messageId: string) {
  const conv = activeConv.value;
  if (!conv) return;
  void chatStore.retryAt(conv.id, messageId);
}

function handleSwitchSibling(messageId: string, direction: -1 | 1) {
  const conv = activeConv.value;
  if (!conv) return;
  chatStore.switchSibling(conv.id, messageId, direction);
}
</script>

<template>
  <div class="flex h-dvh flex-col">
    <!-- Top bar -->
    <app-header :title="t('app.titleChat')" />

    <!-- Message scroller -->
    <MessageScrollerProvider
      v-if="activeConv && thread.length > 0"
      auto-scroll
      default-scroll-position="end"
    >
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            <MessageScrollerItem
              v-for="(item, idx) in thread"
              :key="item.message.id"
              :message-id="item.message.id"
              :scroll-anchor="idx === lastIndex"
              class="max-w-full w-3xl mx-auto p-4"
            >
              <ChatMessage
                :message="item.message"
                :is-last="idx === lastIndex"
                :streaming="chatStore.streaming"
                :sibling-index="item.siblingIndex"
                :sibling-count="item.siblingCount"
                @edit="handleEdit"
                @retry="handleRetry"
                @switch-sibling="handleSwitchSibling"
              />
            </MessageScrollerItem>
            <p class="mb-2 text-center text-xs text-muted-foreground">
              {{ t("chat.disclaimer") }}
            </p>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton variant="outline" class="rounded-full" />
      </MessageScroller>
    </MessageScrollerProvider>

    <!-- Empty state -->
    <Empty v-else>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles />
        </EmptyMedia>
        <EmptyTitle>{{ t("chat.emptyTitle") }}</EmptyTitle>
        <EmptyDescription>
          {{ t("chat.emptyDescription") }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>

    <!-- Compact composer: model + settings + input centralized here -->
    <ChatInput
      :streaming="chatStore.streaming"
      :models="models"
      :model="chatStore.model"
      :params="chatStore.params"
      :reasoning-effort="chatStore.reasoningEffort"
      @send="handleSend"
      @stop="handleStop"
      @update:model="(id) => (chatStore.model = id)"
      @update:params="(p) => (chatStore.params = { ...p })"
      @update:reasoning-effort="(v) => (chatStore.reasoningEffort = v)"
    />
  </div>
</template>
