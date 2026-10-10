<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  MessageSquareText,
  Image as ImageIcon,
  ChevronsUpDown,
  Settings,
} from "@lucide/vue";

import { currentDirection } from "@/lib/i18n";
import SyncStatus from "@/components/SyncStatus.vue";
import ChatSidebarGroup from "@/components/chat/ChatSidebarGroup.vue";
import DrawSidebarGroup from "@/components/draw/DrawSidebarGroup.vue";
import SettingsModal from "@/components/settings/SettingsModal.vue";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const { t } = useI18n();
const { isMobile, setOpenMobile } = useSidebar();
const route = useRoute();
const router = useRouter();

// Reactive layout direction: the sidebar docks on the inline-start side and
// its mode menu opens toward inline-end.
const direction = computed(() => currentDirection());

const settingsOpen = ref(false);

const modes = computed(() => [
  {
    key: "chat",
    name: t("app.titleChat"),
    description: t("nav.chatDescription"),
    icon: MessageSquareText,
    to: "/chat",
  },
  {
    key: "draw",
    name: t("app.titleDraw"),
    description: t("nav.drawDescription"),
    icon: ImageIcon,
    to: "/draw",
  },
]);

const activeMode = computed(
  () =>
    modes.value.find((mode) => route.path.startsWith(mode.to)) ??
    modes.value[0],
);

function switchMode(to: string): void {
  router.push(to);
  if (isMobile.value) setOpenMobile(false);
}
</script>

<template>
  <Sidebar :side="direction === 'rtl' ? 'right' : 'left'">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton
                size="lg"
                class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div
                  class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
                >
                  <component :is="activeMode.icon" class="size-4" />
                </div>

                <div class="grid flex-1 text-start text-sm leading-tight">
                  <span class="truncate font-medium">
                    {{ activeMode.name }}
                  </span>
                  <span class="truncate text-xs">
                    {{ activeMode.description }}
                  </span>
                </div>

                <ChevronsUpDown class="ms-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              class="min-w-56 rounded-lg"
              align="start"
              :side="
                isMobile
                  ? 'bottom'
                  : direction === 'rtl'
                    ? 'left'
                    : 'right'
              "
              :side-offset="4"
            >
              <DropdownMenuLabel class="text-xs text-muted-foreground">
                {{ t("nav.modes") }}
              </DropdownMenuLabel>

              <DropdownMenuItem
                v-for="mode in modes"
                :key="mode.key"
                class="gap-2 p-2"
                @click="switchMode(mode.to)"
              >
                <div
                  class="flex size-8 items-center justify-center rounded-sm border"
                >
                  <component :is="mode.icon" class="size-4 shrink-0" />
                </div>

                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">{{ mode.name }}</p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ mode.description }}
                  </p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <ChatSidebarGroup v-if="activeMode.key === 'chat'" />
      <DrawSidebarGroup v-else-if="activeMode.key === 'draw'" />
    </SidebarContent>

    <SidebarFooter>
      <SyncStatus />

      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton @click="settingsOpen = true">
            <Settings />
            {{ t("common.settings") }}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />

    <SettingsModal v-model:open="settingsOpen" />
  </Sidebar>
</template>
