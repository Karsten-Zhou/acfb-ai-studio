<script setup lang="ts">
import AppSidebar from "@/components/AppSidebar.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useChatStore } from "@/stores/chat";
import { useSyncEngine } from "@/composables/sync";
import { useTitle } from "@vueuse/core";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import "vue-sonner/style.css";
import { Toaster } from "@/components/ui/sonner";

// Mounted once for the lifetime of app: polls for changes made on other
// devices and uploads local edits.
useSyncEngine();

const chatStore = useChatStore();
const { t } = useI18n({ useScope: "global" });
const route = useRoute();
const router = useRouter();

const title = computed(() => {
  if (route.name === "chat" || route.name === "chat-conversation") {
    return t("app.titleChat");
  } else if (route.name === "draw" || route.name === "draw-image") {
    return t("app.titleDraw");
  } else {
    return t("app.title");
  }
});
useTitle(title);

// -------------------------------------------------------------------------
// UI Actions (Drive the router)
// -------------------------------------------------------------------------

function handleSelect(id: string) {
  router.push(`/chat/${id}`);
}

function handleNew() {
  router.push("/chat");
}

function handleDelete(id: string) {
  // Store handles the logic (picks next conversation or null).
  // The store -> route watcher below will handle the redirect.
  chatStore.deleteConversation(id);
}

function handleRename(id: string, title: string) {
  chatStore.renameConversation(id, title);
}

// -------------------------------------------------------------------------
// Sync: Route -> Store (User navigated via URL or UI action)
// -------------------------------------------------------------------------
watch(
  () => route.path,
  (path) => {
    if (path === "/chat") {
      if (chatStore.activeId !== null) {
        chatStore.startNewConversation(); // sets activeId to null
      }
    } else if (path.startsWith("/chat/")) {
      const id = Array.isArray(route.params.id)
        ? route.params.id[0]
        : (route.params.id as string);
      if (id) {
        const conv = chatStore.conversationById(id);
        if (conv) {
          if (chatStore.activeId !== id) {
            chatStore.switchConversation(id);
          }
        } else {
          // Conversation doesn't exist (e.g., deleted on another device)
          router.replace("/chat");
        }
      }
    }
  },
  { immediate: true },
);

// -------------------------------------------------------------------------
// Sync: Store -> Route (Store state changed independently, e.g., deletion)
// -------------------------------------------------------------------------
watch(
  () => chatStore.activeId,
  (newId) => {
    // Only update route if we are currently in the chat section
    if (route.path.startsWith("/chat")) {
      if (newId) {
        if (route.params.id !== newId) {
          router.replace(`/chat/${newId}`);
        }
      } else {
        if (route.path !== "/chat") {
          router.replace("/chat");
        }
      }
    }
  },
);
</script>

<template>
  <SidebarProvider class="h-full min-h-0">
    <AppSidebar
      :conversations="chatStore.conversations"
      :active-id="chatStore.activeId"
      @select="handleSelect"
      @new="handleNew"
      @delete="handleDelete"
      @rename="handleRename"
    />
    <SidebarInset class="h-full min-w-0">
      <RouterView />
    </SidebarInset>
  </SidebarProvider>
  <Toaster
    :toast-options="{
      descriptionClass: 'overflow-y-auto max-h-24',
    }"
  />
</template>
