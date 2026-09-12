import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import "@/style.css";
import App from "@/App.vue";
import { router } from "@/router";
import { queryClient } from "@/lib/query-client";
import { i18n } from "@/lib/i18n";
import { initPreferences } from "@/stores/preferences";

const app = createApp(App);

app.use(createPinia());
app.use(i18n);
app.use(router);
app.use(VueQueryPlugin, { queryClient });

// Apply the persisted theme + language before the first render.
initPreferences();

app.mount("#app");
