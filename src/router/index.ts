import { createRouter, createWebHistory } from "vue-router";
import ChatView from "@/views/ChatView.vue";
import DrawView from "@/views/DrawView.vue";
import ImageView from "@/views/ImageView.vue";
import NotFoundView from "@/views/NotFoundView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/chat" },
    { path: "/chat", name: "chat", component: ChatView },
    { path: "/draw", name: "draw", component: DrawView },
    { path: "/draw/:id", name: "draw-image", component: ImageView },
    { path: "/:pathMatch(.*)*", name: "not-found", component: NotFoundView },
  ],
});
