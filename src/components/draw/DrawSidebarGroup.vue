<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { Plus, Pencil, Trash2 } from "@lucide/vue";

import { useDrawStore } from "@/stores/draw";
import { formatNumber } from "@/lib/i18n";
import RenameDialog from "@/components/RenameDialog.vue";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog.vue";
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
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";

const { t } = useI18n();
const router = useRouter();
const drawStore = useDrawStore();
const { isMobile, setOpenMobile } = useSidebar();

/** Close the ephemeral mobile drawer after an action. */
function closeMobile(): void {
  if (isMobile.value) setOpenMobile(false);
}

function startNew(): void {
  router.push("/draw");
  closeMobile();
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
  if (renameId.value) drawStore.renameGalleryItem(renameId.value, title);
}

// --- Delete ---------------------------------------------------------------
const deleteOpen = ref(false);
const deleteId = ref<string | null>(null);
const deleteAll = ref(false);

function openDelete(id: string): void {
  deleteId.value = id;
  deleteAll.value = false;
  deleteOpen.value = true;
}

function openDeleteAll(): void {
  deleteId.value = null;
  deleteAll.value = true;
  deleteOpen.value = true;
}

function confirmDelete(): void {
  if (deleteAll.value) {
    drawStore.clearGallery();
  } else if (deleteId.value) {
    drawStore.deleteGalleryItem(deleteId.value);
  }
  deleteOpen.value = false;
}
</script>

<template>
  <SidebarGroup>
    <SidebarGroupLabel class="flex items-center justify-between">
      <span>
        {{ t("nav.images", { count: formatNumber(drawStore.gallery.length) }) }}
      </span>

      <Button
        v-if="drawStore.gallery.length"
        size="icon-xs"
        variant="ghost"
        :aria-label="t('nav.clearImageHistory')"
        @click="openDeleteAll"
      >
        <Trash2 />
      </Button>
    </SidebarGroupLabel>

    <SidebarGroupContent>
      <ScrollArea>
        <SidebarMenu>
          <RouterLink to="/draw" as-child>
            <SidebarMenuButton @click="startNew">
              <Plus />
              {{ t("nav.newImage") }}
            </SidebarMenuButton>
          </RouterLink>

          <template v-if="drawStore.gallery.length">
            <SidebarMenuItem v-for="item in drawStore.gallery" :key="item.id">
              <Item variant="outline" class="p-2">
                <RouterLink :to="`/draw/${item.id}`" @click="closeMobile">
                  <ItemHeader>
                    <img
                      :src="item.image"
                      :alt="item.title || item.prompt"
                      class="aspect-square w-full rounded-sm object-cover"
                    />
                  </ItemHeader>
                </RouterLink>

                <ItemContent>
                  <RouterLink :to="`/draw/${item.id}`" @click="closeMobile">
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
                    @click.stop="openRename(item.id, item.title || item.prompt)"
                  >
                    <Pencil class="size-4" />
                    <span class="sr-only">{{ t("common.edit") }}</span>
                  </Button>

                  <Button
                    variant="ghost"
                    :title="t('common.delete')"
                    @click.stop="openDelete(item.id)"
                  >
                    <Trash2 class="size-4" />
                    <span class="sr-only">{{ t("common.delete") }}</span>
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

  <RenameDialog
    v-model:open="renameOpen"
    :initial="renameInitial"
    @save="saveRename"
  />

  <ConfirmDeleteDialog
    v-model:open="deleteOpen"
    :title="deleteAll ? t('nav.clearImageHistory') : t('common.deleteTitle')"
    :description="
      deleteAll
        ? t('nav.clearImageHistoryDescription')
        : t('common.deleteImageDescription')
    "
    :action-label="
      deleteAll ? t('nav.clearImageHistoryAction') : t('common.delete')
    "
    @confirm="confirmDelete"
  />
</template>
