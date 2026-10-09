<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { Plus, Pencil, Trash2, MoreHorizontal, Download } from "@lucide/vue";

import { useChatStore } from "@/stores/chat";
import { downloadFile, exportConversations } from "@/lib/conversation-backup";
import { toastError } from "@/lib/toast";
import RenameDialog from "@/components/RenameDialog.vue";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog.vue";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";

const { t } = useI18n();
const router = useRouter();
const chatStore = useChatStore();
const { isMobile, setOpenMobile } = useSidebar();

const conversations = computed(() => chatStore.conversations);
const activeId = computed(() => chatStore.activeId);

/**
 * Close the mobile navigation drawer after an action. Desktop keeps the
 * sidebar open; only the ephemeral mobile sheet is dismissed.
 */
function closeMobile(): void {
  if (isMobile.value) setOpenMobile(false);
}

function select(id: string): void {
  router.push(`/chat/${id}`);
  closeMobile();
}

function startNew(): void {
  router.push("/chat");
  closeMobile();
}

/** Download the conversation as a llama.cpp-compatible JSONL history file. */
function exportConversation(id: string): void {
  const conv = chatStore.conversationById(id);
  if (!conv) {
    toastError(t("common.export"), t("chat.conversationNotFound"));
    return;
  }
  const { filename, bytes } = exportConversations([conv]);
  downloadFile(filename, bytes);
}

// --- Rename ---------------------------------------------------------------
const renameOpen = ref(false);
const renameId = ref<string | null>(null);
const renameInitial = ref("");

function openRename(id: string, title: string): void {
  renameId.value = id;
  renameInitial.value = title;
  renameOpen.value = true;
}

function saveRename(title: string): void {
  if (renameId.value) chatStore.renameConversation(renameId.value, title);
}

// --- Delete ---------------------------------------------------------------
const deleteOpen = ref(false);
const deleteId = ref<string | null>(null);

function openDelete(id: string): void {
  deleteId.value = id;
  deleteOpen.value = true;
}

function confirmDelete(): void {
  if (deleteId.value) chatStore.deleteConversation(deleteId.value);
  deleteOpen.value = false;
}
</script>

<template>
  <SidebarGroup>
    <SidebarGroupLabel>{{ t("nav.conversations") }}</SidebarGroupLabel>

    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton @click="startNew">
            <Plus />
            {{ t("nav.newConversation") }}
          </SidebarMenuButton>
        </SidebarMenuItem>

        <SidebarMenuItem v-for="conv in conversations" :key="conv.id">
          <SidebarMenuButton
            :is-active="conv.id === activeId"
            @click="select(conv.id)"
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
                @click="openRename(conv.id, conv.title || t('common.untitled'))"
              >
                <Pencil />
                <span>{{ t("common.edit") }}</span>
              </DropdownMenuItem>

              <DropdownMenuItem @click="exportConversation(conv.id)">
                <Download />
                <span>{{ t("common.export") }}</span>
              </DropdownMenuItem>

              <DropdownMenuItem
                variant="destructive"
                @click="openDelete(conv.id)"
              >
                <Trash2 />
                <span>{{ t("common.delete") }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>

        <Empty v-if="conversations.length === 0" class="border border-dashed">
          <EmptyHeader>
            <EmptyDescription>
              {{ t("nav.noConversations") }}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>

  <RenameDialog
    v-model:open="renameOpen"
    :initial="renameInitial"
    @save="saveRename"
  />

  <ConfirmDeleteDialog
    v-model:open="deleteOpen"
    :title="t('common.deleteTitle')"
    :description="t('common.deleteConversationDescription')"
    :action-label="t('common.delete')"
    @confirm="confirmDelete"
  />
</template>
