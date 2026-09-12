<script setup lang="ts">
import AppSidebar from "@/components/AppSidebar.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useChatStore } from "@/stores/chat";
import { useSyncEngine } from "@/composables/sync";
import { useTitle } from "@vueuse/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import "vue-sonner/style.css";
import { Toaster } from "@/components/ui/sonner";

// Mounted once for the lifetime of the app: polls for changes made on other
// devices and uploads local edits.
useSyncEngine();

const chatStore = useChatStore();
const { t } = useI18n({ useScope: "global" });
const route = useRoute();
const title = computed(() => {
  if (route.name === "chat") {
    return t("app.titleChat");
  } else if (route.name === "draw") {
    return t("app.titleDraw");
  } else {
    return t("app.title");
  }
});
useTitle(title);
</script>

<template>
  <SidebarProvider>
    <AppSidebar
      :conversations="chatStore.conversations"
      :active-id="chatStore.activeId"
      @select="chatStore.switchConversation"
      @new="chatStore.startNewConversation"
      @delete="chatStore.deleteConversation"
    />
    <SidebarInset class="h-dvh">
      <RouterView />
    </SidebarInset>
  </SidebarProvider>
  <Toaster
    :toast-options="{
      descriptionClass: 'overflow-y-auto max-h-24',
    }"
  />
</template>
