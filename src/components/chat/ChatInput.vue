<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowUp, Square, ChevronsUpDown, Brain } from "@lucide/vue";
import type { FreeTextModel } from "@shared/generated/models";
import type { GenerationParams, ReasoningEffort } from "@shared/chat";
import { acceptsParam } from "@shared/generated/traits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FREE_TEXT_GENERATION_MODEL_LABELS } from "@shared/catalog-types";

const props = defineProps<{
  streaming: boolean;
  models: readonly FreeTextModel[];
  model: string;
  params: GenerationParams;
  reasoningEffort: ReasoningEffort;
}>();

const { t } = useI18n({ useScope: "global" });

/** Undefined until the user (or the catalog default) picks a model. */
const selectedModel = computed(() =>
  props.models.find((m) => m.name === props.model),
);

const emit = defineEmits<{
  (e: "send", content: string): void;
  (e: "stop"): void;
  (e: "update:model", id: string): void;
  (e: "update:params", params: GenerationParams): void;
  (e: "update:reasoningEffort", value: ReasoningEffort): void;
}>();

const draft = ref("");

const currentModel = computed(() => {
  const found = props.models.find((m) => m.name === props.model);
  return found
    ? FREE_TEXT_GENERATION_MODEL_LABELS[found.name]
    : props.model || t("chat.chooseModel");
});

function submit() {
  const text = draft.value.trim();
  if (!text || props.streaming) return;
  emit("send", text);
  draft.value = "";
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}

// reasoning efforts
const efforts = computed<{ value: ReasoningEffort; label: string }[]>(() => [
  { value: "off", label: t("chat.effortOff") },
  { value: "minimal", label: t("chat.effortMinimal") },
  { value: "low", label: t("chat.effortLow") },
  { value: "medium", label: t("chat.effortMedium") },
  { value: "high", label: t("chat.effortHigh") },
]);
</script>

<template>
  <div class="border-t border-border bg-background px-3 pb-3 pt-2">
    <div
      class="mx-auto flex w-full max-w-3xl flex-col gap-1.5 rounded-xl border border-input bg-card p-2 shadow-xs focus-within:ring-2 focus-within:ring-ring/50"
    >
      <Textarea
        v-model="draft"
        :rows="1"
        :placeholder="t('chat.inputPlaceholder')"
        class="max-h-40 min-h-6 w-full resize-none border-0 bg-transparent px-1 text-sm shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
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
          <DropdownMenuContent align="start" class="max-h-72 max-w-52">
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
                  {{ FREE_TEXT_GENERATION_MODEL_LABELS[m.name] }}
                </span>
                <Brain v-if="m.capabilities.reasoning" />
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Reasoning settings -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              :disabled="
                !selectedModel?.capabilities.reasoning ||
                !acceptsParam(model, 'reasoning_effort')
              "
            >
              <Brain />
              <template v-if="!selectedModel?.capabilities.reasoning">
                {{ t("chat.effortOff") }}
              </template>
              <template v-else-if="!acceptsParam(model, 'reasoning_effort')">
                {{ t("chat.fixed") }}
              </template>
              <template v-else>
                {{
                  efforts.find((e) => e.value === reasoningEffort)?.label ??
                  t("chat.reasoning")
                }}
              </template>
              <ChevronsUpDown class="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            class="max-h-72 max-w-52 overflow-y-auto"
          >
            <DropdownMenuRadioGroup
              :model-value="reasoningEffort"
              @update:model-value="
                (v) => emit('update:reasoningEffort', v as ReasoningEffort)
              "
            >
              <DropdownMenuRadioItem
                v-for="e in efforts"
                :key="e.value"
                :value="e.value"
              >
                {{ e.label }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div class="flex-1" />

        <Button
          v-if="streaming"
          size="icon-sm"
          variant="secondary"
          class="rounded-full"
          @click="emit('stop')"
        >
          <Square class="size-4 fill-current" />
          <span class="sr-only">{{ t("chat.stopGenerating") }}</span>
        </Button>
        <Button
          v-else
          size="icon-sm"
          :disabled="!draft.trim()"
          class="rounded-full"
          @click="submit"
        >
          <ArrowUp class="size-4" />
          <span class="sr-only">{{ t("chat.send") }}</span>
        </Button>
      </div>
    </div>
  </div>
</template>
