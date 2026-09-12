<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  MessageSquareText,
  Plus,
  Trash2,
  Image as ImageIcon,
  ChevronsUpDown,
  Settings,
} from "@lucide/vue";
import type { Conversation } from "@shared/chat";
import { useDrawStore } from "@/stores/draw";
import SyncStatus from "@/components/SyncStatus.vue";
import SettingsModal from "@/components/settings/SettingsModal.vue";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemHeader,
  ItemActions,
  ItemTitle,
} from "@/components/ui/item";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
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
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const props = defineProps<{
  conversations: Conversation[];
  activeId: string | null;
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "new"): void;
  (e: "delete", id: string): void;
}>();

const { t } = useI18n({ useScope: "global" });
const drawStore = useDrawStore();
const { isMobile } = useSidebar();
const route = useRoute();
const router = useRouter();

/** Open state of the settings modal (rendered at the end of the template). */
const settingsOpen = ref(false);

/**
 * The two top-level user "modes": chat with models vs. generate images. The
 * active one drives both the header switcher and which content the sidebar
 * shows.
 */
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
  () => modes.value.find((m) => route.path.startsWith(m.to)) || modes.value[0],
);

const sorted = computed(() => [...props.conversations]);

/** Latest first ordering of generated images. */
const gallery = computed(() => drawStore.gallery);
</script>

<template>
  <Sidebar>
    <SidebarHeader>
      <!-- Mode switcher (Chat / Draw) -->
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
                <div class="grid flex-1 text-left text-sm leading-tight">
                  <span class="truncate font-medium">
                    {{ activeMode.name }}
                  </span>
                  <span class="truncate text-xs">
                    {{ activeMode.description }}
                  </span>
                </div>
                <ChevronsUpDown class="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              class="w-(--reka-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              align="start"
              :side="isMobile ? 'bottom' : 'right'"
              :side-offset="4"
            >
              <DropdownMenuLabel class="text-xs text-muted-foreground">
                {{ t("nav.modes") }}
              </DropdownMenuLabel>
              <DropdownMenuItem
                v-for="mode in modes"
                :key="mode.key"
                class="gap-2 p-2"
                @click="router.push(mode.to)"
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
      <!-- Conversation list is chat-only -->
      <SidebarGroup v-if="activeMode.key === 'chat'">
        <SidebarGroupLabel>{{ t("nav.conversations") }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton @click="emit('new')">
                <Plus />
                {{ t("nav.newConversation") }}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-for="conv in sorted" :key="conv.id">
              <SidebarMenuButton
                :is-active="conv.id === activeId"
                @click="emit('select', conv.id)"
              >
                <span>{{ conv.title || t("common.untitled") }}</span>
              </SidebarMenuButton>
              <SidebarMenuAction
                show-on-hover
                :title="t('common.delete')"
                @click="emit('delete', conv.id)"
              >
                <Trash2 />
                <span class="sr-only">{{ t("common.delete") }}</span>
              </SidebarMenuAction>
            </SidebarMenuItem>

            <Empty
              v-if="conversations.length === 0"
              class="border border-dashed"
            >
              <EmptyHeader>
                <EmptyDescription>
                  {{ t("nav.noConversations") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <!-- Generated-image history is draw-only -->
      <SidebarGroup v-else-if="activeMode.key === 'draw'">
        <SidebarGroupLabel class="flex items-center justify-between">
          <span>{{ t("nav.images", { count: gallery.length }) }}</span>
          <!-- Delete all images -->
          <AlertDialog>
            <AlertDialogTrigger>
              <Button
                v-if="gallery.length"
                size="icon-xs"
                variant="ghost"
                :aria-label="t('nav.clearImageHistory')"
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{{ t("nav.clearImageHistory") }}</AlertDialogTitle>
                <AlertDialogDescription>
                  {{ t("nav.clearImageHistoryDescription") }}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                <AlertDialogAction @click.stop="drawStore.clearGallery">
                  {{ t("nav.clearImageHistoryAction") }}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <ScrollArea v-if="gallery.length">
            <SidebarMenu>
              <SidebarMenuItem v-for="item in gallery" :key="item.id">
                <Item as-child variant="outline" class="p-2">
                  <RouterLink :to="`/draw/${item.id}`">
                    <ItemHeader>
                      <img
                        :src="item.image"
                        :alt="item.prompt"
                        class="aspect-square w-full rounded-sm object-cover"
                      />
                    </ItemHeader>
                    <ItemContent>
                      <ItemTitle class="line-clamp-2">
                        {{ item.prompt }}
                      </ItemTitle>
                      <ItemDescription>
                        {{ item.model }}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        :title="t('common.delete')"
                        variant="ghost"
                        @click="drawStore.deleteGalleryItem(item.id)"
                      >
                        <Trash2 class="size-4" />
                      </Button>
                    </ItemActions>
                  </RouterLink>
                </Item>
              </SidebarMenuItem>
            </SidebarMenu>
            <ScrollBar />
          </ScrollArea>
          <Empty v-else class="border border-dashed">
            <EmptyHeader>
              <EmptyDescription>{{ t("nav.noImages") }}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SidebarGroupContent>
      </SidebarGroup>
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
      <span class="px-2 text-xs text-muted-foreground">
        {{ t("nav.poweredBy") }}
      </span>
    </SidebarFooter>

    <SidebarRail />

    <SettingsModal v-model:open="settingsOpen" />
  </Sidebar>
</template>
