<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  MessageSquareText,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  Image as ImageIcon,
  ChevronsUpDown,
  Settings,
} from "@lucide/vue";
import type { Conversation } from "@shared/chat";

import { useChatStore } from "@/stores/chat";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const props = defineProps<{
  conversations: Conversation[];
  activeId: string | null;
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "new"): void;
  (e: "delete", id: string): void;
  (e: "rename", id: string, title: string): void;
}>();

const { t } = useI18n({ useScope: "global" });
const chatStore = useChatStore();
const drawStore = useDrawStore();
const { isMobile } = useSidebar();
const route = useRoute();
const router = useRouter();

const settingsOpen = ref(false);

/** Rename dialog state. */
const renameOpen = ref(false);
const renameId = ref<string | null>(null);
const renameKind = ref<"conversation" | "image" | null>(null);
const renameTitle = ref("");

/** Delete confirmation state. */
const deleteOpen = ref(false);
const deleteId = ref<string | null>(null);
const deleteKind = ref<"conversation" | "image" | "all-images" | null>(null);

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

const sorted = computed(() => [...props.conversations]);
const gallery = computed(() => drawStore.gallery);

function openRename(
  kind: "conversation" | "image",
  id: string,
  title: string,
): void {
  renameKind.value = kind;
  renameId.value = id;
  renameTitle.value = title;
  renameOpen.value = true;
}

function closeRename(): void {
  renameOpen.value = false;
  renameId.value = null;
  renameKind.value = null;
  renameTitle.value = "";
}

function saveRename(): void {
  if (!renameId.value || !renameKind.value) return;

  const id = renameId.value;
  const kind = renameKind.value;
  const title = renameTitle.value.trim();

  if (!title) return;

  closeRename();

  if (kind === "conversation") {
    emit("rename", id, title);
  } else {
    drawStore.renameGalleryItem(id, title);
  }
}

function openDelete(
  kind: "conversation" | "image" | "all-images",
  id: string | null = null,
): void {
  deleteKind.value = kind;
  deleteId.value = id;
  deleteOpen.value = true;
}

function closeDelete(): void {
  deleteOpen.value = false;
  deleteId.value = null;
  deleteKind.value = null;
}

function confirmDelete(): void {
  if (!deleteKind.value) return;

  const kind = deleteKind.value;
  const id = deleteId.value;

  closeDelete();

  if (kind === "conversation" && id) {
    emit("delete", id);
  } else if (kind === "image" && id) {
    drawStore.deleteGalleryItem(id);
  } else if (kind === "all-images") {
    drawStore.clearGallery();
  }
}

const deleteDialogTitle = computed(() =>
  deleteKind.value === "all-images"
    ? t("nav.clearImageHistory")
    : t("common.deleteTitle"),
);

const deleteDialogDescription = computed(() => {
  switch (deleteKind.value) {
    case "all-images":
      return t("nav.clearImageHistoryDescription");
    case "conversation":
      return t("common.deleteConversationDescription");
    case "image":
      return t("common.deleteImageDescription");
    default:
      return t("common.deleteDescription");
  }
});

const deleteActionLabel = computed(() =>
  deleteKind.value === "all-images"
    ? t("nav.clearImageHistoryAction")
    : t("common.delete"),
);
</script>

<template>
  <Sidebar>
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
              class="min-w-56 rounded-lg"
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
                  <p class="truncate text-sm font-medium">
                    {{ mode.name }}
                  </p>
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
      <!-- Conversations -->
      <SidebarGroup v-if="activeMode.key === 'chat'">
        <SidebarGroupLabel>
          {{ t("nav.conversations") }}
        </SidebarGroupLabel>

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
                <span
                  class="truncate"
                  :class="chatStore.titlesPendingIds.has(conv.id) && 'shimmer'"
                >
                  {{ conv.title || t("common.untitled") }}
                </span>
              </SidebarMenuButton>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <SidebarMenuAction show-on-hover>
                    <MoreHorizontal />
                  </SidebarMenuAction>
                </DropdownMenuTrigger>

                <DropdownMenuContent>
                  <DropdownMenuItem
                    @click="
                      openRename(
                        'conversation',
                        conv.id,
                        conv.title || t('common.untitled'),
                      )
                    "
                  >
                    <Pencil />
                    <span>{{ t("common.edit") }}</span>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    variant="destructive"
                    @click="openDelete('conversation', conv.id)"
                  >
                    <Trash2 />
                    <span>{{ t("common.delete") }}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

      <!-- Generated images -->
      <SidebarGroup v-else-if="activeMode.key === 'draw'">
        <SidebarGroupLabel class="flex items-center justify-between">
          <span>{{ t("nav.images", { count: gallery.length }) }}</span>

          <Button
            v-if="gallery.length"
            size="icon-xs"
            variant="ghost"
            :aria-label="t('nav.clearImageHistory')"
            @click="openDelete('all-images')"
          >
            <Trash2 />
          </Button>
        </SidebarGroupLabel>

        <SidebarGroupContent>
          <ScrollArea>
            <SidebarMenu>
              <RouterLink to="/draw" as-child>
                <SidebarMenuButton @click="emit('new')">
                  <Plus />
                  {{ t("nav.newImage") }}
                </SidebarMenuButton>
              </RouterLink>

              <template v-if="gallery.length">
                <SidebarMenuItem v-for="item in gallery" :key="item.id">
                  <Item variant="outline" class="p-2">
                    <RouterLink :to="`/draw/${item.id}`">
                      <ItemHeader>
                        <img
                          :src="item.image"
                          :alt="item.title || item.prompt"
                          class="aspect-square w-full rounded-sm object-cover"
                        />
                      </ItemHeader>
                    </RouterLink>

                    <ItemContent>
                      <RouterLink :to="`/draw/${item.id}`">
                        <ItemTitle
                          class="line-clamp-2"
                          :class="
                            drawStore.titlesPendingIds.has(item.id) && 'shimmer'
                          "
                        >
                          {{ item.title || item.prompt }}
                        </ItemTitle>
                      </RouterLink>

                      <ItemDescription>
                        {{ item.model }}
                      </ItemDescription>
                    </ItemContent>

                    <ItemActions>
                      <Button
                        variant="ghost"
                        :title="t('common.edit')"
                        @click.stop="
                          openRename(
                            'image',
                            item.id,
                            item.title || item.prompt,
                          )
                        "
                      >
                        <Pencil class="size-4" />
                        <span class="sr-only">
                          {{ t("common.edit") }}
                        </span>
                      </Button>

                      <Button
                        variant="ghost"
                        :title="t('common.delete')"
                        @click.stop="openDelete('image', item.id)"
                      >
                        <Trash2 class="size-4" />
                        <span class="sr-only">
                          {{ t("common.delete") }}
                        </span>
                      </Button>
                    </ItemActions>
                  </Item>
                </SidebarMenuItem>
              </template>

              <Empty v-else class="border border-dashed">
                <EmptyHeader>
                  <EmptyDescription>
                    {{ t("nav.noImages") }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </SidebarMenu>

            <ScrollBar />
          </ScrollArea>
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
    </SidebarFooter>

    <SidebarRail />

    <SettingsModal v-model:open="settingsOpen" />

    <!-- Rename dialog -->
    <Dialog v-model:open="renameOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {{ t("common.renameTitle") }}
          </DialogTitle>
          <DialogDescription>
            {{ t("common.renameDescription") }}
          </DialogDescription>
        </DialogHeader>

        <Input
          v-model="renameTitle"
          autofocus
          :aria-label="t('common.rename')"
          @keydown.enter.prevent="saveRename"
        />

        <DialogFooter>
          <Button variant="outline" @click="closeRename">
            {{ t("common.cancel") }}
          </Button>

          <Button :disabled="!renameTitle.trim()" @click="saveRename">
            {{ t("common.renameAction") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete confirmation -->
    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ deleteDialogTitle }}
          </AlertDialogTitle>

          <AlertDialogDescription>
            {{ deleteDialogDescription }}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>
            {{ t("common.cancel") }}
          </AlertDialogCancel>
          <Button variant="destructive" @click="confirmDelete">
            {{ deleteActionLabel }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Sidebar>
</template>
