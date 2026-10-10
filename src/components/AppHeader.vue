<script lang="ts" setup>
import { computed } from "vue";
import { PanelLeft, PanelRight } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { currentDirection } from "@/lib/i18n";

const props = defineProps<{
  title: string;
}>();

// The ui SidebarTrigger hardcodes a left-panel glyph; mirror it here so the
// icon depicts the side the sidebar actually docks on.
const { toggleSidebar } = useSidebar();
const isRtl = computed(() => currentDirection() === "rtl");
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-2">
    <div class="flex flex-1 items-center gap-2 px-3">
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        aria-label="Toggle Sidebar"
        @click="toggleSidebar"
      >
        <PanelRight v-if="isRtl" />
        <PanelLeft v-else />
      </Button>
      <Separator
        orientation="vertical"
        class="me-2 data-[orientation=vertical]:h-4"
      />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage class="line-clamp-1">
              {{ props.title }}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  </header>
</template>
