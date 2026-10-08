<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useDrawStore } from "@/stores/draw";
import { formatNumber } from "@/lib/i18n";
import AppHeader from "@/components/AppHeader.vue";

const { t } = useI18n({ useScope: "global" });
const draw = useDrawStore();
const route = useRoute();
const router = useRouter();

const galleryItem = computed(() =>
  draw.gallery.find((item) => item.id === route.params.id),
);

watch(galleryItem, (newVal) => {
  if (!newVal) {
    router.push("/draw");
  }
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Header -->
    <AppHeader
      :title="galleryItem?.title || galleryItem?.prompt || t('app.titleDraw')"
    />

    <!-- Content -->
    <div class="flex min-h-0 flex-1 flex-col">
      <!-- Image: takes all available height -->
      <div
        v-if="galleryItem"
        class="flex min-h-0 flex-1 items-center justify-center p-4"
      >
        <img
          :src="galleryItem.image"
          :alt="t('draw.generatedImage')"
          class="max-w-full max-h-full object-contain rounded-md"
        />
      </div>

      <!-- Info: stays at bottom -->
      <div class="shrink-0 space-y-1 p-4 text-center">
        <p class="text-sm text-wrap">
          {{ galleryItem?.title || galleryItem?.prompt }}
        </p>

        <p class="text-xs text-wrap text-muted-foreground">
          {{ galleryItem?.prompt }}
        </p>

        <p class="text-xs text-wrap text-muted-foreground">
          {{ formatNumber(galleryItem?.width) }} x
          {{ formatNumber(galleryItem?.height) }}
          | {{ galleryItem?.model }}
        </p>
      </div>
    </div>
  </div>
</template>
