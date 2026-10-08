<script setup lang="ts">
// Ported from llama.cpp's settings > Export selection dialog.
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Search } from "@lucide/vue";
import type { Conversation } from "@shared/chat";
import { Button } from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox/Checkbox.vue";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const props = defineProps<{
  conversations: Conversation[];
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "export", conversations: Conversation[]): void;
}>();

const { t } = useI18n();

const searchQuery = ref("");
const selected = reactive<Record<string, boolean>>({});
const lastRowIndex = ref(-1);

function messageCount(conv: Conversation): number {
  return conv.messages.filter((m) => !m.error).length;
}

function displayName(conv: Conversation): string {
  return conv.title || t("settings.untitledConversation");
}

function reset(): void {
  for (const c of props.conversations) selected[c.id] = true;
  searchQuery.value = "";
  lastRowIndex.value = -1;
}

// Reset the selection each time the dialog opens.
watch(
  () => props.open,
  (open) => {
    if (open) reset();
  },
);

const filtered = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return props.conversations;
  return props.conversations.filter((c) =>
    displayName(c).toLowerCase().includes(query),
  );
});

const allSelected = computed(
  () =>
    filtered.value.length > 0 && filtered.value.every((c) => selected[c.id]),
);
const someSelected = computed(
  () => filtered.value.some((c) => selected[c.id]) && !allSelected.value,
);
const selectedCount = computed(
  () => Object.values(selected).filter(Boolean).length,
);

// Derived select-all state; the setter flips the whole filtered list.
const headerChecked = computed<boolean | "indeterminate">({
  get: () =>
    allSelected.value ? true : someSelected.value ? "indeterminate" : false,
  set: () => toggleAll(),
});

function toggleAll(): void {
  if (allSelected.value) {
    for (const c of filtered.value) selected[c.id] = false;
  } else {
    for (const c of filtered.value) selected[c.id] = true;
  }
}

function toggleRow(index: number, shiftKey: boolean): void {
  const row = filtered.value[index];
  if (!row) return;

  if (shiftKey && lastRowIndex.value >= 0) {
    const from = Math.min(lastRowIndex.value, index);
    const to = Math.max(lastRowIndex.value, index);
    for (let i = from; i <= to; i++) {
      const c = filtered.value[i];
      if (c) selected[c.id] = true;
    }
  } else {
    selected[row.id] = !selected[row.id];
  }
  lastRowIndex.value = index;
}

// The checkbox handles its own click; handling it here would double-toggle.
function onRowClick(event: MouseEvent, index: number): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest('[data-slot="checkbox"]')) return;
  toggleRow(index, event.shiftKey);
}

function handleConfirm(): void {
  const picked = props.conversations.filter((c) => selected[c.id]);
  emit("export", picked);
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t("settings.selectConversations") }}</DialogTitle>
        <DialogDescription>
          {{ t("settings.selectConversationsDescription") }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div class="relative">
          <Search
            class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            class="pl-8"
            :placeholder="t('settings.searchConversations')"
          />
        </div>

        <p class="text-sm text-muted-foreground">
          {{
            t("settings.selectedCount", {
              selected: selectedCount,
              total: conversations.length,
            })
          }}
          <span v-if="searchQuery">
            {{ t("settings.shownCount", { count: filtered.length }) }}
          </span>
        </p>

        <div class="overflow-hidden rounded-md border">
          <ScrollArea class="h-64">
            <table class="w-full">
              <thead class="sticky top-0 z-10 bg-muted">
                <tr class="border-b">
                  <th class="w-12 p-3 text-left">
                    <Checkbox v-model="headerChecked" />
                  </th>
                  <th class="p-3 text-left text-sm font-medium">
                    {{ t("settings.conversationName") }}
                  </th>
                  <th class="w-24 p-3 text-left text-sm font-medium">
                    {{ t("settings.messages") }}
                  </th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="filtered.length === 0">
                  <td
                    class="p-8 text-center text-sm text-muted-foreground"
                    colspan="3"
                  >
                    <template v-if="searchQuery">
                      {{
                        t("settings.noConversationsMatching", {
                          query: searchQuery,
                        })
                      }}
                    </template>
                    <template v-else>
                      {{ t("settings.noConversationsAvailable") }}
                    </template>
                  </td>
                </tr>
                <template v-else>
                  <tr
                    v-for="(conv, index) in filtered"
                    :key="conv.id"
                    class="cursor-pointer border-b transition-colors hover:bg-muted/50"
                    :class="{ 'bg-muted/75': selected[conv.id] }"
                    @click="onRowClick($event, index)"
                  >
                    <td class="p-3">
                      <Checkbox v-model="selected[conv.id]" />
                    </td>
                    <td class="p-3 text-sm">
                      <div class="max-w-64 truncate" :title="displayName(conv)">
                        {{ displayName(conv) }}
                      </div>
                    </td>
                    <td class="p-3 text-sm text-muted-foreground">
                      {{ messageCount(conv) }}
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </ScrollArea>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t("common.cancel") }}
        </Button>
        <Button :disabled="selectedCount === 0" @click="handleConfirm">
          {{ t("settings.exportCount", { count: selectedCount }) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
