import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import "@/style.css";
import App from "@/App.vue";
import { router } from "@/router";
import { queryClient } from "@/lib/query-client";
import { i18n } from "@/lib/i18n";
import { initAppStorage } from "@/lib/app-storage";
import { initPreferences } from "@/stores/preferences";
import { useChatStore } from "@/stores/chat";
import { useDrawStore } from "@/stores/draw";

async function bootstrap(): Promise<void> {
  // Fold the old localStorage payload into IndexedDB before any store reads it.
  await initAppStorage();

  const pinia = createPinia();
  const app = createApp(App);

  app.use(pinia);
  app.use(i18n);
  app.use(router);
  app.use(VueQueryPlugin, { queryClient });

  // Creating the stores starts their IndexedDB read. Mounting before that read
  // lands would let an early mutation be discarded — or worse, be persisted
  // over the state still in flight.
  await Promise.all([
    useChatStore(pinia).hydrated,
    useDrawStore(pinia).hydrated,
  ]);

  // Apply the persisted theme + language before the first render.
  initPreferences();

  app.mount("#app");
}

void bootstrap();
