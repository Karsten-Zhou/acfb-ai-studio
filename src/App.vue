<script setup lang="ts">
import AppSidebar from "@/components/AppSidebar.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useChatStore } from "@/stores/chat";
import { useSyncEngine } from "@/composables/sync";
import { useTitle } from "@vueuse/core";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ConfigProvider } from "reka-ui";
import "vue-sonner/style.css";
import { Toaster } from "@/components/ui/sonner";
import { dirForLocale, type Direction, type Locale } from "@/lib/i18n";

// Mounted once for the lifetime of app: polls for changes made on other
// devices and uploads local edits.
useSyncEngine();

const chatStore = useChatStore();
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

// Reka UI primitives (menus, poppers, navigation) resolve RTL behaviour from
// the ConfigProvider direction, so derive it from the active locale here and
// let the whole component tree inherit it.
const dir = computed<Direction>(() => dirForLocale(locale.value as Locale));

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
  <ConfigProvider :dir="dir" :locale="locale">
    <SidebarProvider class="h-full min-h-0">
      <AppSidebar />
      <SidebarInset class="h-full min-w-0">
        <RouterView />
      </SidebarInset>
    </SidebarProvider>
    <Toaster
      :toast-options="{
        descriptionClass: 'overflow-y-auto max-h-24',
      }"
    />
  </ConfigProvider>
</template>
