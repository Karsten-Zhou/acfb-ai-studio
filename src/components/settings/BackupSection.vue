<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { Archive, Download, Upload } from "@lucide/vue";
import type { Conversation } from "@shared/chat";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import ConversationSelectionDialog from "@/components/settings/ConversationSelectionDialog.vue";
import { useChatStore } from "@/stores/chat";
import { toastError } from "@/lib/toast";
import {
  downloadFile,
  exportConversations,
  parseBackupFile,
} from "@/lib/conversation-backup";

const { t } = useI18n();
const chatStore = useChatStore();

const fileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const exportOpen = ref(false);

function handleExport(selected: Conversation[]): void {
  exportOpen.value = false;
  if (selected.length === 0) return;
  const { filename, bytes } = exportConversations(selected);
  downloadFile(filename, bytes);
  toast.success(t("settings.exportSuccess", { count: selected.length }));
}

async function handleFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  // Reset so re-selecting the same file still fires `change`.
  input.value = "";
  if (files.length === 0) return;

  importing.value = true;
  try {
    const restored: Conversation[] = [];
    let skipped = 0;

    for (const file of files) {
      const result = parseBackupFile(new Uint8Array(await file.arrayBuffer()), {
        model: chatStore.model,
        defaultTitle: t("settings.importedTitle"),
      });
      if (!result.ok) {
        toastError(t("settings.importFailed"), `${file.name}: ${result.error}`);
        continue;
      }
      restored.push(...result.conversations);
      skipped += result.skipped;
    }

    if (restored.length > 0) {
      chatStore.importConversations(restored);
      toast.success(t("settings.importSuccess", { count: restored.length }));
      if (skipped > 0) {
        toast(t("settings.importSkipped", { count: skipped }));
      }
    }
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <section class="space-y-4">
    <h2 class="flex items-center gap-1.5 text-sm font-semibold">
      <Archive class="size-4" />
      {{ t("settings.backup") }}
    </h2>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex-1 space-y-0.5">
          <Label class="text-muted-foreground">
            {{ t("settings.exportConversations") }}
          </Label>
          <p class="text-xs text-muted-foreground">
            {{ t("settings.exportConversationsDescription") }}
          </p>
        </div>
        <Button
          class="shrink-0"
          size="sm"
          :disabled="chatStore.conversations.length === 0 || importing"
          @click="exportOpen = true"
        >
          <Download />
          {{ t("settings.exportConversations") }}
        </Button>
      </div>
    </div>

    <ConversationSelectionDialog
      v-model:open="exportOpen"
      :conversations="chatStore.conversations"
      @export="handleExport"
    />

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex-1 space-y-0.5">
          <Label class="text-muted-foreground">
            {{ t("settings.import") }}
          </Label>
          <p class="text-xs text-muted-foreground">
            {{ t("settings.importDescription") }}
          </p>
        </div>
        <Button
          size="sm"
          class="shrink-0"
          variant="outline"
          :disabled="importing"
          @click="fileInput?.click()"
        >
          <Upload />
          {{ t("settings.import") }}
        </Button>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept=".jsonl,.json,.zip,application/json,application/jsonl,application/zip"
        multiple
        class="hidden"
        :aria-label="t('settings.import')"
        @change="handleFiles"
      />
    </div>
  </section>
</template>
