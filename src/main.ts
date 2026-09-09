import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import "@/style.css";
import App from "@/App.vue";
import { router } from "@/router";
import { queryClient } from "@/lib/query-client";

createApp(App)
  .use(router)
  .use(VueQueryPlugin, { queryClient })
  .mount("#app");
