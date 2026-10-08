<script setup lang="ts">
import { X } from "@lucide/vue";
import type { Attachment } from "@shared/chat";
import { Button } from "@/components/ui/button";

defineProps<{
  attachments: readonly Attachment[];
  /** When true the remove buttons are hidden (e.g. read-only rendering). */
  readonly?: boolean;
}>();

const emit = defineEmits<{ (e: "remove", id: string): void }>();
</script>

<template>
  <div v-if="attachments.length" class="flex flex-wrap gap-2">
    <div
      v-for="a in attachments"
      :key="a.id"
      class="group relative overflow-hidden rounded-md border"
    >
      <img
        :src="a.dataUrl"
        :alt="a.name ?? 'attachment'"
        class="h-20 w-20 object-cover"
      />
      <Button
        v-if="!readonly"
        variant="secondary"
        size="icon-xs"
        class="absolute right-1 top-1 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        :aria-label="$t('chat.removeAttachment')"
        @click="emit('remove', a.id)"
      >
        <X class="size-3" />
      </Button>
    </div>
  </div>
</template>
