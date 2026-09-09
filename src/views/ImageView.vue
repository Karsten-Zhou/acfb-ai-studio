<script setup lang="ts">
import { useRoute } from "vue-router";
import { drawStore } from "@/composables/draw";
import { computed, watch } from "vue";
import { useRouter } from "vue-router";

const route = useRoute();
const galleryItem = computed(() =>
  drawStore.gallery.find((item) => item.id === route.params.id),
);
const router = useRouter();
watch(galleryItem, (newVal) => {
  if (!newVal) {
    router.push("/draw");
  }
});
</script>
<template>
  <div class="flex flex-col gap-2 m-auto h-full items-center justify-center p-4" >
    <!-- Image -->
    <div v-if="galleryItem" class="flex justify-center">
      <img
        :src="galleryItem.image"
        alt="Generated Image"
        class="max-w-full max-h-[80vh] rounded-md"
      />
    </div>
    <!-- Info -->
    <p class="text-xs text-center truncate text-muted-foreground text-wrap">
      {{ galleryItem?.prompt }}
    </p>
    <p class="text-xs text-center truncate text-muted-foreground text-wrap">
      {{ galleryItem?.width }} x {{ galleryItem?.height }} |
      {{ galleryItem?.model }}
    </p>
  </div>
</template>
