<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowUp,
  Square,
  ChevronsUpDown,
  Brain,
  Paperclip,
  Wrench,
  Image as ImageIcon,
} from "@lucide/vue";
import type { FreeTextModel } from "@shared/generated/models";
import type {
  Attachment,
  GenerationParams,
  ReasoningEffort,
} from "@shared/chat";
import { normalizeReasoningEffort } from "@shared/reasoning";
import {
  getReasoningOptions,
  supportsImageInput,
  supportsToolCalling,
} from "@shared/generated/traits";
import { IMAGE_ACCEPT_ATTRIBUTE } from "@shared/attachments";
import { modelLabel } from "@shared/catalog-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TOOLS } from "@shared/tools";
import { defaultOptions } from "@/composables/chat-defaults";
import { readAttachments } from "@/composables/use-attachments";
import { toastError } from "@/lib/toast";
import AttachmentList from "./AttachmentList.vue";

const props = defineProps<{
  streaming: boolean;
  models: readonly FreeTextModel[];
  model: string;
  params: GenerationParams;
  reasoningEffort: ReasoningEffort;
}>();

const { t } = useI18n();

/** Undefined until the user (or the catalog default) picks a model. */
const selectedModel = computed(() =>
  props.models.find((m) => m.name === props.model),
);

/** Whether the selected model documents image input. */
const canAttach = computed(() =>
  props.model ? supportsImageInput(props.model) : false,
);

function isToolEnabled(id: string): boolean {
  return (defaultOptions.tools ?? []).includes(id);
}

function setToolEnabled(id: string, enabled: boolean): void {
  const current = new Set(defaultOptions.tools ?? []);
  if (enabled) current.add(id);
  else current.delete(id);
  defaultOptions.tools = [...current];
}

/** Whether the selected model's schema declares tool-calling support. */
const canUseTools = computed(() =>
  props.model ? supportsToolCalling(props.model) : false,
);

const emit = defineEmits<{
  (e: "send", content: string, attachments: Attachment[]): void;
  (e: "stop"): void;
  (e: "update:model", id: string): void;
  (e: "update:params", params: GenerationParams): void;
  (e: "update:reasoningEffort", value: ReasoningEffort): void;
}>();

const draft = ref("");
const attachments = ref<Attachment[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const currentModel = computed(() =>
  props.model ? modelLabel(props.model) : t("chat.chooseModel"),
);

function submit() {
  const text = draft.value.trim();
  const files = attachments.value;
  if ((!text && files.length === 0) || props.streaming) return;
  emit("send", text, files);
  draft.value = "";
  attachments.value = [];
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}

function openPicker() {
  fileInput.value?.click();
}

async function onFilesChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (files.length === 0) return;

  const { attachments: added, errors } = await readAttachments(
    files,
    attachments.value.length,
  );
  if (added.length > 0) attachments.value = [...attachments.value, ...added];
  for (const error of errors) {
    toastError(
      t("chat.attachmentFailed"),
      `${error.fileName}: ${error.message}`,
    );
  }
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter((a) => a.id !== id);
}

// ---------------------------------------------------------------------------
// Reasoning controls
//
// The offered levels come from the model's own schema (see
// shared/reasoning.ts): a graded `reasoning_effort` enum, a binary chat-template
// toggle, both, or neither. Nothing is hardcoded here.
// ---------------------------------------------------------------------------

/** Levels the selected model offers, ascending; empty when not adjustable. */
const reasoningOptions = computed<ReasoningEffort[]>(() =>
  props.model ? getReasoningOptions(props.model) : [],
);

const canAdjustReasoning = computed(() => reasoningOptions.value.length > 0);

/** The stored effort snapped to a level this model actually offers. */
const selectedEffort = computed<ReasoningEffort | undefined>(() =>
  normalizeReasoningEffort(props.reasoningEffort, reasoningOptions.value),
);

/**
 * One literal `t()` call per level so i18n tooling can see every message is
 * used. Covers the full canonical scale; `getReasoningOptions` only ever
 * yields a subset of these.
 */
const EFFORT_LABELS: Record<ReasoningEffort, () => string> = {
  none: () => t("chat.reasoningLevel.none"),
  minimal: () => t("chat.reasoningLevel.minimal"),
  low: () => t("chat.reasoningLevel.low"),
  medium: () => t("chat.reasoningLevel.medium"),
  high: () => t("chat.reasoningLevel.high"),
  xhigh: () => t("chat.reasoningLevel.xhigh"),
  max: () => t("chat.reasoningLevel.max"),
};
const effortLabel = (effort: ReasoningEffort): string =>
  EFFORT_LABELS[effort]();
/**
 * When the model changes, its offered levels change with it. Snap the stored
 * default to the nearest offered level so the control reflects what will
 * actually be sent (the server snaps identically). Skipped while there is no
 * model, to avoid clobbering the persisted default during init.
 */
watch(
  [() => props.model, reasoningOptions],
  () => {
    const snapped = selectedEffort.value;
    if (props.model && snapped && snapped !== props.reasoningEffort) {
      emit("update:reasoningEffort", snapped);
    }
  },
  { immediate: true },
);

const reasoningLabel = computed(() => {
  if (!canAdjustReasoning.value) {
    // No knob: a reasoning-capable model that always reasons reads "Fixed";
    // anything else has no reasoning to speak of.
    return selectedModel.value?.capabilities.reasoning
      ? t("chat.fixed")
      : t("chat.reasoningLevel.none");
  }
  return selectedEffort.value
    ? effortLabel(selectedEffort.value)
    : t("chat.reasoning");
});
</script>

<template>
  <div class="border-t border-border bg-background px-3 pb-3 pt-2">
    <div
      class="mx-auto flex w-full max-w-3xl flex-col gap-1.5 rounded-xl border border-input bg-card p-2 shadow-xs focus-within:ring-2 focus-within:ring-ring/50"
    >
      <AttachmentList
        v-if="attachments.length"
        :attachments="attachments"
        class="px-1 pt-1"
        @remove="removeAttachment"
      />

      <Textarea
        v-model="draft"
        :rows="1"
        dir="auto"
        :placeholder="t('chat.inputPlaceholder')"
        class="max-h-40 min-h-6 w-full resize-none border-0 bg-transparent px-1 text-start text-sm shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
        :disabled="streaming"
        @keydown="onKeydown"
      />

      <!-- Compact toolbar: model + settings on the left, actions on the right -->
      <div class="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm">
              {{ currentModel }}
              <ChevronsUpDown class="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="max-h-72 w-64">
            <DropdownMenuRadioGroup
              :model-value="model"
              @update:model-value="(id) => emit('update:model', id as string)"
            >
              <DropdownMenuRadioItem
                v-for="m in models"
                :key="m.name"
                :value="m.name"
              >
                <span class="min-w-0 flex-1 truncate">
                  {{ modelLabel(m.name) }}
                </span>
                <span
                  class="flex shrink-0 items-center gap-1 text-muted-foreground"
                >
                  <Brain
                    v-if="m.capabilities.reasoning"
                    :title="t('chat.reasoning')"
                  />
                  <Wrench
                    v-if="supportsToolCalling(m.name)"
                    :title="t('chat.tools')"
                  />
                  <ImageIcon
                    v-if="supportsImageInput(m.name)"
                    :title="t('chat.attachFile')"
                  />
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Reasoning settings -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm" :disabled="!canAdjustReasoning">
              <Brain />
              {{ reasoningLabel }}
              <ChevronsUpDown
                v-if="canAdjustReasoning"
                class="text-muted-foreground"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            class="max-h-72 max-w-52 overflow-y-auto"
          >
            <DropdownMenuRadioGroup
              :model-value="selectedEffort"
              @update:model-value="
                (v) => emit('update:reasoningEffort', v as ReasoningEffort)
              "
            >
              <DropdownMenuRadioItem
                v-for="e in reasoningOptions"
                :key="e"
                :value="e"
              >
                {{ effortLabel(e) }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Tools: only offered when the model's schema declares tool calling -->
        <DropdownMenu v-if="canUseTools">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm">
              <Wrench />
              {{ t("chat.tools") }}
              <ChevronsUpDown class="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="max-w-64">
            <DropdownMenuCheckboxItem
              v-for="tool in TOOLS"
              :key="tool.id"
              :model-value="isToolEnabled(tool.id)"
              @update:model-value="(v) => setToolEnabled(tool.id, v === true)"
              @select.prevent
            >
              <span class="min-w-0 flex-1 truncate">{{ tool.label }}</span>
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Attachment picker: only shown when the model documents image input -->
        <Button
          v-if="canAttach"
          variant="ghost"
          size="icon-sm"
          :disabled="streaming"
          :aria-label="t('chat.attachFile')"
          :title="t('chat.attachFile')"
          @click="openPicker"
        >
          <Paperclip />
        </Button>
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          multiple
          :accept="IMAGE_ACCEPT_ATTRIBUTE"
          @change="onFilesChosen"
        />

        <div class="flex-1" />

        <Button
          v-if="streaming"
          size="icon-sm"
          variant="secondary"
          class="rounded-full"
          :aria-label="t('chat.stopGenerating')"
          @click="emit('stop')"
        >
          <Square class="fill-current" />
        </Button>
        <Button
          v-else
          size="icon-sm"
          :disabled="!draft.trim() && attachments.length === 0"
          class="rounded-full"
          :aria-label="t('chat.send')"
          @click="submit"
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  </div>
</template>
