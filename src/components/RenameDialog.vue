<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const props = defineProps<{
  open: boolean;
  initial: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "save", title: string): void;
}>();

const { t } = useI18n();
const title = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) title.value = props.initial;
  },
);

function close(): void {
  emit("update:open", false);
}

function save(): void {
  const value = title.value.trim();
  if (!value) return;
  emit("save", value);
  close();
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("common.renameTitle") }}</DialogTitle>
        <DialogDescription>
          {{ t("common.renameDescription") }}
        </DialogDescription>
      </DialogHeader>

      <Input
        v-model="title"
        autofocus
        :aria-label="t('common.rename')"
        @keydown.enter.prevent="save"
      />

      <DialogFooter>
        <Button variant="outline" @click="close">
          {{ t("common.cancel") }}
        </Button>
        <Button :disabled="!title.trim()" @click="save">
          {{ t("common.renameAction") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
