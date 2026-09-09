<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  MessageSquareText,
  Plus,
  Trash2,
  Image as ImageIcon,
  ChevronsUpDown,
} from "@lucide/vue";
import type { Conversation } from "@shared/chat";
import { drawStore, deleteGalleryItem, clearGallery } from "@/composables/draw";
import SyncStatus from "@/components/SyncStatus.vue";
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

const { isMobile } = useSidebar();
const route = useRoute();
const router = useRouter();

/**
 * The two top-level user "modes": chat with models vs. generate images. The
 * active one drives both the header switcher and which content the sidebar
 * shows.
 */
const modes = [
  {
    key: "chat",
    name: "Workers AI Chat",
    description: "Talk to a text model",
    icon: MessageSquareText,
    to: "/chat",
  },
  {
    key: "draw",
    name: "Workers AI Draw",
    description: "Generate images from text",
    icon: ImageIcon,
    to: "/draw",
  },
];

const activeMode = computed(
  () => modes.find((m) => route.path.startsWith(m.to)) || modes[0],
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
                Modes
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
        <SidebarGroupLabel>Conversations</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton @click="emit('new')">
                <Plus />
                New Conversation
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-for="conv in sorted" :key="conv.id">
              <SidebarMenuButton
                :is-active="conv.id === activeId"
                @click="emit('select', conv.id)"
              >
                <span>{{ conv.title || "Untitled" }}</span>
              </SidebarMenuButton>
              <SidebarMenuAction
                show-on-hover
                title="Delete"
                @click="emit('delete', conv.id)"
              >
                <Trash2 />
                <span class="sr-only">Delete</span>
              </SidebarMenuAction>
            </SidebarMenuItem>

            <Empty
              v-if="conversations.length === 0"
              class="border border-dashed"
            >
              <EmptyHeader>
                <EmptyDescription> No conversations yet </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <!-- Generated-image history is draw-only -->
      <SidebarGroup v-else-if="activeMode.key === 'draw'">
        <SidebarGroupLabel class="flex items-center justify-between">
          <span>Images ({{ gallery.length }})</span>
          <!-- Delete all images -->
          <AlertDialog>
            <AlertDialogTrigger>
              <Button
                v-if="gallery.length"
                size="icon-xs"
                variant="ghost"
                aria-label="Clear image history"
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear Image History</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete
                  your account and remove your datas.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction @click.stop="clearGallery">
                  Continue
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
                        title="Delete"
                        variant="ghost"
                        @click="deleteGalleryItem(item.id)"
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
              <EmptyDescription> No images yet </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <SyncStatus />
      <span class="px-2 text-xs text-muted-foreground">
        Powered by Workers AI
      </span>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
