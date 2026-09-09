<script setup lang="ts">
import AppSidebar from "@/components/AppSidebar.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  chatStore,
  deleteConversation,
  startNewConversation,
  switchConversation,
} from "@/composables/chat";
import { useSyncEngine } from "@/composables/sync";
import { useTitle } from "@vueuse/core";
import { computed } from "vue";
import { useRoute } from "vue-router";
import "vue-sonner/style.css";
import { Toaster } from "@/components/ui/sonner";

// Mounted once for the lifetime of the app: polls for changes made on other
// devices and uploads local edits.
useSyncEngine();

const route = useRoute();
const title = computed(() => {
  if (route.name === "chat") {
    return "Workers AI Chat";
  } else if (route.name === "draw") {
    return "Workers AI Draw";
  } else {
    return "Workers AI";
  }
});
useTitle(title);
</script>

<template>
  <SidebarProvider>
    <AppSidebar
      :conversations="chatStore.conversations"
      :active-id="chatStore.activeId"
      @select="switchConversation"
      @new="startNewConversation"
      @delete="deleteConversation"
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
