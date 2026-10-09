<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  Send,
} from "@lucide/vue";
import type { ChatMessage, ToolCall } from "@shared/chat";
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
import { AlertCircleIcon } from "@lucide/vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatNumber } from "@/lib/i18n";
import MarkdownContent from "./MarkdownContent.vue";
import AttachmentList from "./AttachmentList.vue";
import ToolCallList from "./ToolCallList.vue";

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

const { t } = useI18n();

type AssistantPart =
  { type: "content"; text: string } | { type: "tools"; calls: ToolCall[] };

/**
 * The assistant reply as an ordered timeline: prose segments interleaved with
 * the tool calls that interrupted them. Each call records the content length at
 * the moment it was requested (`contentOffset`), so it renders exactly where it
 * happened rather than all at the top of the message.
 */
const assistantParts = computed<AssistantPart[]>(() => {
  const content = props.message.content ?? "";
  const calls = props.message.toolCalls ?? [];
  if (calls.length === 0) return [{ type: "content", text: content }];

  const groups = new Map<number, ToolCall[]>();
  for (const call of calls) {
    const offset = Math.max(
      0,
      Math.min(call.contentOffset ?? 0, content.length),
    );
    const bucket = groups.get(offset);
    if (bucket) bucket.push(call);
    else groups.set(offset, [call]);
  }

  const parts: AssistantPart[] = [];
  let cursor = 0;
  for (const offset of [...groups.keys()].sort((a, b) => a - b)) {
    if (offset > cursor) {
      parts.push({ type: "content", text: content.slice(cursor, offset) });
      cursor = offset;
    }
    parts.push({ type: "tools", calls: groups.get(offset) ?? [] });
  }
  if (cursor < content.length) {
    parts.push({ type: "content", text: content.slice(cursor) });
  }
  return parts;
});

const editing = ref(false);
const draft = ref("");
const copied = ref(false);
const reasoningOpen = ref(false);
const editArea = ref<InstanceType<typeof Textarea> | null>(null);

/**
 * Long user messages are clamped to a fixed height with a show more / show less
 * toggle (ChatGPT style). COLLAPSED_MAX_HEIGHT_PX is the visible ceiling while
 * collapsed; isOverflowing records whether the full text exceeds it and thus
 * whether the toggle should render at all.
 */
const COLLAPSED_MAX_HEIGHT_PX = 320;
const contentEl = ref<HTMLElement | null>(null);
const collapsed = ref(true);
const isOverflowing = ref(false);

function measureOverflow() {
  const el = contentEl.value;
  if (!el) return;
  isOverflowing.value = el.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + 8;
  if (!isOverflowing.value) collapsed.value = true;
}

// Rendered height can change without the text changing (viewport resize, font
// load), so observe the element as well as the content.
watch(contentEl, (el, _previous, onCleanup) => {
  if (!el || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => measureOverflow());
  observer.observe(el);
  onCleanup(() => observer.disconnect());
});

watch(
  () => props.message.content,
  () => void nextTick(measureOverflow),
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
  // A message that was sent with attachments only (no text) can be re-edited
  // to have text, but the text itself is still required by the input, so an
  // empty edit is rejected.
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

          <template v-else>
            <AttachmentList
              v-if="message.role === 'user' && message.attachments?.length"
              :attachments="message.attachments"
              readonly
              class="mb-2"
            />

            <div v-if="message.role === 'user' && message.content">
              <div class="relative">
                <p
                  ref="contentEl"
                  class="whitespace-pre-wrap"
                  :class="{ 'overflow-hidden': collapsed }"
                  :style="
                    collapsed
                      ? { maxHeight: COLLAPSED_MAX_HEIGHT_PX + 'px' }
                      : undefined
                  "
                >
                  {{ message.content }}
                </p>
                <div
                  v-if="isOverflowing && collapsed"
                  class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted to-transparent"
                />
              </div>
              <button
                v-if="isOverflowing"
                type="button"
                class="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                @click="collapsed = !collapsed"
              >
                <span>
                  {{ collapsed ? t("chat.showMore") : t("chat.showLess") }}
                </span>
                <ChevronDown
                  class="size-3.5 transition-transform"
                  :class="{ 'rotate-180': !collapsed }"
                />
              </button>
            </div>

            <template v-else-if="message.role === 'assistant'">
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
                  <MarkdownContent
                    :source="message.reasoning ?? ''"
                    class="prose prose-sm max-w-none dark:prose-invert"
                  />
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

              <template v-for="(part, index) in assistantParts" :key="index">
                <ToolCallList
                  v-if="part.type === 'tools'"
                  :tool-calls="part.calls"
                  :streaming="isLast && streaming"
                />
                <MarkdownContent
                  v-if="part.type === 'content' && part.text"
                  :source="part.text"
                  class="prose max-w-none dark:prose-invert"
                />
              </template>
              <span
                v-if="isLast && streaming && message.content"
                class="inline-block h-4 w-0.5 animate-pulse bg-current align-middle"
              />
            </template>
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
            {{ formatNumber(siblingIndex) }}/{{ formatNumber(siblingCount) }}
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
