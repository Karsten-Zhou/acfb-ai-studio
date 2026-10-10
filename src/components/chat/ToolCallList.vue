<script setup lang="ts">
// Renders the tool-calling steps taken while producing an assistant reply.
//
// Each step is a collapsible showing the tool name, the arguments the model
// sent, and the result the server returned. Kept presentational: the steps are
// already fully populated on the message by the chat store.
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronRight, Wrench } from "@lucide/vue";
import type { ToolCall } from "@shared/chat";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TOOL_BY_ID } from "@shared/tools";

const props = defineProps<{
  toolCalls: ToolCall[];
  /** True while the owning reply is still streaming. */
  streaming: boolean;
}>();

const { t } = useI18n();

/** Pretty-print a JSON string, falling back to the raw text when invalid. */
function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

const steps = computed(() =>
  props.toolCalls.map((call) => ({
    call,
    label: TOOL_BY_ID.get(call.name)?.label ?? call.name,
    args: pretty(call.arguments || "{}"),
    result: call.result ? pretty(call.result) : undefined,
    // Still running: announced but no result yet, while the reply streams.
    pending: props.streaming && call.result === undefined,
  })),
);

/** Which steps are expanded. Defaults to none; the user opens them on demand. */
const open = ref<Record<string, boolean>>({});

function toggle(id: string): void {
  open.value[id] = !open.value[id];
}
</script>

<template>
  <div class="space-y-2 my-2">
    <Collapsible
      v-for="step in steps"
      :key="step.call.id"
      :open="!!open[step.call.id]"
      @update:open="toggle(step.call.id)"
    >
      <CollapsibleTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground"
          :aria-label="
            open[step.call.id] ? t('chat.hideToolCall') : t('chat.showToolCall')
          "
        >
          <Wrench />
          <span class="truncate" :class="{ shimmer: step.pending }">
            {{ t("chat.toolCall", { name: step.label }) }}
          </span>
          <ChevronRight
            class="transition-transform"
            :class="open[step.call.id] ? 'rotate-90' : 'rtl:-rotate-90'"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent class="my-2 space-y-2 rounded-md border p-3 text-xs">
        <div>
          <div class="mb-1 font-medium text-muted-foreground">
            {{ t("chat.toolArguments") }}
          </div>
          <pre
            class="overflow-x-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap"
            >{{ step.args }}</pre>
        </div>
        <div v-if="step.result !== undefined || step.call.error">
          <div class="mb-1 font-medium text-muted-foreground">
            {{ t("chat.toolResult") }}
          </div>
          <pre
            v-if="step.result !== undefined"
            class="overflow-x-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap"
            >{{ step.result }}</pre>
          <p v-if="step.call.error" class="text-destructive">
            {{ step.call.error }}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
