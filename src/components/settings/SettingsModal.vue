<script setup lang="ts">
// Settings modal — responsive by viewport:
//   desktop → centred Dialog, small screens → slide-up Drawer.
// Both render the same `SettingsContent`, so the sections are written once.
import { useMediaQuery } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import SettingsContent from "@/components/settings/SettingsContent.vue";

const open = defineModel<boolean>("open", { required: true });

const { t } = useI18n({ useScope: "global" });
const isDesktop = useMediaQuery("(min-width: 768px)");
</script>

<template>
  <Dialog
    v-if="isDesktop"
    :open="open"
    @update:open="(value) => (open = value)"
  >
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("settings.title") }}</DialogTitle>
        <DialogDescription>{{ t("settings.description") }}</DialogDescription>
      </DialogHeader>
      <SettingsContent />
    </DialogContent>
  </Dialog>

  <Drawer v-else :open="open" @update:open="(value) => (open = value)">
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>{{ t("settings.title") }}</DrawerTitle>
        <DrawerDescription>{{ t("settings.description") }}</DrawerDescription>
      </DrawerHeader>
      <div class="overflow-y-auto px-4 pb-6">
        <SettingsContent />
      </div>
    </DrawerContent>
  </Drawer>
</template>
