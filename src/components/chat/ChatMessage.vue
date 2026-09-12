<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { usePreferencesStore } from "@/stores/preferences";
import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  Send,
} from "@lucide/vue";
import type { ChatMessage } from "@shared/chat";
import { cachedMarkdown } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircleIcon} from "@lucide/vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const props = defineProps<{
  message: ChatMessage;
  isLast: boolean;
  streaming: boolean;
  /** 1-based position within this node's sibling group. */
  siblingIndex: number;
  siblingCount: number;
}>();

/**
 * Actions are intentionally coarse: the parent maps them onto the store's
 * branch operations (`editAndResend` / `retryAt` / `switchSibling`), so this
 * component stays a dumb presenter. Everything is addressed by message id —
 * never by list index — because the visible thread changes under branching.
 */
const emit = defineEmits<{
  (e: "edit", messageId: string, content: string): void;
  (e: "retry", messageId: string): void;
  (e: "switchSibling", messageId: string, direction: -1 | 1): void;
}>();

const { t } = useI18n({ useScope: "global" });

/**
 * Syntax highlighting follows the *app* theme, not the OS: a user who picks
 * "Light" on a dark desktop must still get light code blocks.
 */
const { isDark } = storeToRefs(usePreferencesStore());

const editing = ref(false);
const draft = ref("");
const copied = ref(false);
const reasoningOpen = ref(false);
const editArea = ref<InstanceType<typeof Textarea> | null>(null);

const html = ref("");
const reasoningHtml = ref("");

watch(
  [
    () => (props.message.role === "assistant" ? props.message.content : ""),
    isDark,
  ],
  async ([source]) => {
    if (!source) {
      html.value = "";
      return;
    }
    html.value = await cachedMarkdown(source, isDark.value);
  },
  { immediate: true },
);

watch(
  [
    () =>
      props.message.role === "assistant" ? (props.message.reasoning ?? "") : "",
    isDark,
  ],
  async ([source]) => {
    if (!source) {
      reasoningHtml.value = "";
      return;
    }
    reasoningHtml.value = await cachedMarkdown(source, isDark.value);
  },
  { immediate: true },
);

watch(
  () => props.isLast && props.streaming,
  (active) => {
    if (active && props.message.reasoning) {
      reasoningOpen.value = true;
    }
  },
  { immediate: true },
);

function startEdit() {
  draft.value = props.message.content;
  editing.value = true;
  void nextTick(() => {
    const el = editArea.value?.$el as HTMLTextAreaElement | undefined;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  });
}

function sendEdit() {
  const content = draft.value.trim();
  if (!content || props.streaming) return;
  editing.value = false;
  emit("edit", props.message.id, content);
}

function cancelEdit() {
  editing.value = false;
}

function onEditKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendEdit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancelEdit();
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(props.message.content);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // Clipboard unavailable.
  }
}
</script>

<template>
  <Message :align="message.role === 'user' ? 'end' : 'start'">
    <MessageContent>
      <Bubble :variant="message.role === 'assistant' ? 'ghost' : 'muted'">
        <BubbleContent>
          <!-- User-message edit mode -->
          <template v-if="editing">
            <Textarea
              ref="editArea"
              v-model="draft"
              rows="4"
              class="resize-y bg-transparent"
              @keydown="onEditKeydown"
            />
            <div class="mt-2 flex gap-2">
              <Button
                size="sm"
                :disabled="streaming || !draft.trim()"
                @click="sendEdit"
              >
                <Send class="size-3.5" />
                {{ t("chat.send") }}
              </Button>
              <Button size="sm" variant="ghost" @click="cancelEdit">
                {{ t("common.cancel") }}
              </Button>
            </div>
          </template>

          <p v-else-if="message.role === 'user'" class="whitespace-pre-wrap">
            {{ message.content }}
          </p>

          <template v-else>
            <Collapsible
              v-if="message.reasoning"
              v-model:open="reasoningOpen"
              class="mb-3"
            >
              <CollapsibleTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground"
                  :aria-label="
                    reasoningOpen
                      ? t('chat.hideReasoning')
                      : t('chat.showReasoning')
                  "
                >
                  <Brain />
                  <span>{{ t("chat.reasoning") }}</span>
                  <ChevronRight
                    class="transition-transform"
                    :class="{ 'rotate-90': reasoningOpen }"
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent class="rounded-md border p-4 my-2">
                <!-- eslint-disable vue/no-v-html -- Html is sanitized by DOMPurify -->
                <div
                  v-if="reasoningHtml"
                  class="prose prose-sm max-w-none dark:prose-invert"
                  v-html="reasoningHtml"
                />
                <!-- eslint-enable vue/no-v-html -->
              </CollapsibleContent>
            </Collapsible>

            <Alert
              v-if="message.error && !message.content"
              variant="destructive"
            >
              <AlertCircleIcon />
              <AlertTitle>{{ t("chat.generationFailed") }}</AlertTitle>
              <AlertDescription class="line-clamp-4">
                {{ message.error }}
              </AlertDescription>
            </Alert>

            <Marker
              v-if="isLast && streaming && !message.content"
              role="status"
            >
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
              <MarkerContent class="shimmer">
                {{ t("chat.thinking") }}
              </MarkerContent>
            </Marker>

            <!-- eslint-disable vue/no-v-html -- Html is sanitized by DOMPurify -->
            <div
              v-if="message.content"
              class="prose max-w-none dark:prose-invert"
              v-html="html"
            ></div>
            <!-- eslint-enable vue/no-v-html -->
            <span
              v-if="isLast && streaming && message.content"
              class="inline-block h-4 w-0.5 animate-pulse bg-current align-middle"
            />
          </template>
        </BubbleContent>
      </Bubble>

      <MessageFooter v-if="!editing">
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="copied ? t('common.copied') : t('chat.copyMessage')"
          :title="t('common.copy')"
          @click="copy"
        >
          <Check v-if="copied" class="size-3.5" />
          <Copy v-else class="size-3.5" />
        </Button>

        <Button
          v-if="message.role === 'user'"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('chat.editMessage')"
          :title="t('common.edit')"
          :disabled="streaming"
          @click="startEdit"
        >
          <Pencil class="size-3.5" />
        </Button>

        <Button
          v-else
          variant="ghost"
          size="icon-sm"
          :aria-label="t('common.tryAgain')"
          :title="t('common.tryAgain')"
          :disabled="streaming"
          @click="emit('retry', message.id)"
        >
          <RefreshCw class="size-3.5" />
        </Button>

        <!-- Sibling-branch navigation (◀ 2/3 ▶) -->
        <div v-if="siblingCount > 1" class="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('chat.previousVersion')"
            :disabled="streaming || siblingIndex <= 1"
            @click="emit('switchSibling', message.id, -1)"
          >
            <ChevronLeft class="size-3.5" />
          </Button>
          <span class="text-xs tabular-nums text-muted-foreground">
            {{ siblingIndex }}/{{ siblingCount }}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('chat.nextVersion')"
            :disabled="streaming || siblingIndex >= siblingCount"
            @click="emit('switchSibling', message.id, 1)"
          >
            <ChevronRight class="size-3.5" />
          </Button>
        </div>
      </MessageFooter>
    </MessageContent>
  </Message>
</template>
