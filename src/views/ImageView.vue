<script setup lang="ts">
import { useRoute } from "vue-router";
import { useDrawStore } from "@/stores/draw";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { formatNumber } from "@/lib/i18n";

const { t } = useI18n({ useScope: "global" });
const draw = useDrawStore();
const route = useRoute();
const galleryItem = computed(() =>
  draw.gallery.find((item) => item.id === route.params.id),
);
const router = useRouter();
watch(galleryItem, (newVal) => {
  if (!newVal) {
    router.push("/draw");
  }
});
</script>
<template>
  <div
    class="flex flex-col gap-2 m-auto h-full items-center justify-center p-4"
  >
    <!-- Image -->
    <div v-if="galleryItem" class="flex justify-center">
      <img
        :src="galleryItem.image"
        :alt="t('draw.generatedImage')"
        class="max-w-full max-h-[80vh] rounded-md"
      />
    </div>
    <!-- Info -->
    <p class="text-sm text-center text-wrap">
      {{ galleryItem?.title || galleryItem?.prompt }}
    </p>
    <p class="text-xs text-center text-wrap text-muted-foreground">
      {{ galleryItem?.prompt }}
    </p>
    <p class="text-xs text-center truncate text-muted-foreground text-wrap">
      {{ formatNumber(galleryItem?.width) }} x
      {{ formatNumber(galleryItem?.height) }} | {{ galleryItem?.model }}
    </p>
  </div>
</template>
