<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Square, Sparkles, TriangleAlert } from "@lucide/vue";
import {
  FREE_TEXT_TO_IMAGE_MODELS,
  type FreeImageModel,
} from "@shared/generated/models";
import {
  acceptsParam,
  getBounds,
  getDefault,
  type ParamBounds,
} from "@shared/generated/traits";
import { useDrawStore, type GalleryItem } from "@/stores/draw";
import { useSyncStore } from "@/stores/sync";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import AppHeader from "@/components/AppHeader.vue";

const { t } = useI18n({ useScope: "global" });
const drawStore = useDrawStore();
const sync = useSyncStore();
const models = FREE_TEXT_TO_IMAGE_MODELS;

/** Currently selected model. `drawStore.options.model` holds the slug (@cf/...). */
const currentModel = computed<FreeImageModel | undefined>(() =>
  models.find((m) => m.name === drawStore.options.model),
);

/** Param bounds are static per model — read them once per selection. */
const widthBounds = computed<ParamBounds | undefined>(() =>
  currentModel.value ? getBounds(currentModel.value.name, "width") : undefined,
);
const heightBounds = computed<ParamBounds | undefined>(() =>
  currentModel.value ? getBounds(currentModel.value.name, "height") : undefined,
);
const stepsBounds = computed<ParamBounds | undefined>(() => {
  const name = currentModel.value?.name;
  if (!name) return undefined;
  return getBounds(name, "num_steps") ?? getBounds(name, "steps");
});
const guidanceBounds = computed<ParamBounds | undefined>(() =>
  currentModel.value
    ? getBounds(currentModel.value.name, "guidance")
    : undefined,
);

/** Which controls the model actually accepts. */
const showSize = computed(() =>
  currentModel.value
    ? acceptsParam(currentModel.value.name, "width") &&
      acceptsParam(currentModel.value.name, "height")
    : false,
);
const showSteps = computed(() =>
  currentModel.value
    ? acceptsParam(currentModel.value.name, "num_steps") ||
      acceptsParam(currentModel.value.name, "steps")
    : false,
);
const showGuidance = computed(() =>
  currentModel.value
    ? acceptsParam(currentModel.value.name, "guidance")
    : false,
);
const showNegative = computed(() =>
  currentModel.value
    ? acceptsParam(currentModel.value.name, "negative_prompt")
    : false,
);

/** Most recent image. */
const latestImage = ref<GalleryItem | null>(null);
drawStore.onGenerationSuccess(() => {
  latestImage.value = drawStore.gallery[0] ?? null;
});

/** Clamp to declared bounds. Missing bounds mean "unbounded on that side". */
function clampNum(value: number, bounds: ParamBounds | undefined): number {
  if (!bounds) return value;
  const min = bounds.min ?? Number.NEGATIVE_INFINITY;
  const max = bounds.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, value));
}

/** A cleared `<Input>` yields `""` — that means "unset", not zero. */
function toSize(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Placeholder showing the model's declared default, or `auto` if it has none. */
function sizePlaceholder(key: "width" | "height"): string {
  const name = currentModel.value?.name;
  const declared = name ? getDefault(name, key) : undefined;
  return typeof declared === "number" ? String(declared) : t("draw.auto");
}

/** Fallback display name until `displayName` lands in the catalogue. */
function label(m: FreeImageModel): string {
  const fallback = m.name.replace(/^@cf\//, "");
  return `${(m as { displayName?: string }).displayName ?? fallback}${
    m.capabilities.beta ? ` (${t("draw.beta")})` : ""
  }`;
}

const prompt = ref("");
const negativePrompt = ref("");
const loading = computed(() => drawStore.generating);

const storageBlocked = computed(() => sync.storageUsage.blocked);

const width = computed<number | undefined>({
  get: () => drawStore.options.width,
  set: (v) => {
    const n = toSize(v);
    drawStore.setDrawOptions({
      width: n === undefined ? undefined : clampNum(n, widthBounds.value),
    });
  },
});
const height = computed<number | undefined>({
  get: () => drawStore.options.height,
  set: (v) => {
    const n = toSize(v);
    drawStore.setDrawOptions({
      height: n === undefined ? undefined : clampNum(n, heightBounds.value),
    });
  },
});
const steps = computed({
  get: () => {
    const b = stepsBounds.value;
    return clampNum(drawStore.options.numSteps ?? b?.min ?? 1, b);
  },
  set: (v) =>
    drawStore.setDrawOptions({
      numSteps: clampNum(Number(v), stepsBounds.value),
    }),
});
const guidance = computed({
  get: () =>
    clampNum(
      drawStore.options.guidance ?? guidanceBounds.value?.min ?? 0,
      guidanceBounds.value,
    ),
  set: (v) =>
    drawStore.setDrawOptions({
      guidance: clampNum(Number(v), guidanceBounds.value),
    }),
});

function submit() {
  const text = prompt.value.trim();
  if (!text || loading.value) return;
  drawStore.generateImage(text, negativePrompt.value.trim() || undefined);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}

/** Pixel step for a size input: snap to 256 when the range is wide enough. */
function stepFor(bounds: ParamBounds | undefined): number | undefined {
  if (bounds?.min === undefined || bounds.max === undefined) return undefined;
  return bounds.max - bounds.min >= 256 ? 256 : 1;
}
</script>

<template>
  <div class="flex h-dvh flex-col">
    <!-- Top bar -->
    <app-header :title="t('app.titleDraw')" />

    <div class="flex flex-row flex-wrap flex-1 gap-2 p-4">
      <!-- Composer (left/up) -->
      <div class="flex min-w-sm flex-1 flex-col gap-3 overflow-y-auto p-2">
        <div class="flex flex-col gap-1.5">
          <Label>{{ t("draw.model") }}</Label>
          <select
            :value="drawStore.options.model"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            @change="
              (e) =>
                drawStore.setDrawModel((e.target as HTMLSelectElement).value)
            "
          >
            <option v-for="m in models" :key="m.name" :value="m.name">
              {{ label(m) }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground">
            {{ currentModel?.description }}
          </p>
        </div>

        <div v-if="showSize" class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1">
            <Label>{{ t("draw.width") }}</Label>
            <Input
              v-model.number="width"
              type="number"
              :placeholder="sizePlaceholder('width')"
              :min="widthBounds?.min"
              :max="widthBounds?.max"
              :step="stepFor(widthBounds)"
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>{{ t("draw.height") }}</Label>
            <Input
              v-model.number="height"
              type="number"
              :placeholder="sizePlaceholder('height')"
              :min="heightBounds?.min"
              :max="heightBounds?.max"
              :step="stepFor(heightBounds)"
            />
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <Label>{{ t("draw.prompt") }}</Label>
          <Textarea
            v-model="prompt"
            :rows="4"
            :placeholder="t('draw.promptPlaceholder')"
            class="resize-none"
            @keydown="onKeydown"
          />
        </div>

        <div v-if="showNegative" class="flex flex-col gap-1">
          <Label>{{ t("draw.negativePrompt") }}</Label>
          <Textarea
            v-model="negativePrompt"
            :rows="2"
            :placeholder="t('draw.negativePromptPlaceholder')"
            class="resize-none"
          />
        </div>

        <div v-if="showSteps" class="flex flex-col gap-1">
          <Label>{{ t("draw.steps") }}</Label>
          <Input
            v-model.number="steps"
            type="number"
            :min="stepsBounds?.min"
            :max="stepsBounds?.max"
            step="1"
          />
        </div>

        <div v-if="showGuidance" class="flex flex-col gap-1">
          <Label>{{ t("draw.guidance") }}</Label>
          <Input
            v-model.number="guidance"
            type="number"
            :min="guidanceBounds?.min"
            :max="guidanceBounds?.max"
            step="0.5"
          />
        </div>

        <Alert v-if="storageBlocked" variant="destructive">
          <TriangleAlert />
          <AlertTitle>{{ t("draw.storageFullTitle") }}</AlertTitle>
          <AlertDescription>
            {{ t("draw.storageFullDescription") }}
          </AlertDescription>
        </Alert>

        <div class="flex items-center gap-2">
          <Button
            class="flex-1"
            :disabled="loading || !prompt.trim() || storageBlocked"
            @click="submit"
          >
            <Sparkles v-if="!loading" class="size-4" />
            <Square v-else class="size-4 fill-current" />
            {{ loading ? t("draw.generating") : t("draw.generate") }}
          </Button>
          <Button
            v-if="loading"
            size="icon"
            variant="secondary"
            :aria-label="t('draw.stopGenerating')"
            @click="drawStore.stopGenerating"
          >
            <Square class="size-4 fill-current" />
          </Button>
        </div>
      </div>

      <!-- Most recent generation (full history lives in the sidebar) -->
      <div class="flex-1 min-w-sm overflow-y-auto">
        <Empty
          v-if="!latestImage && !loading"
          class="h-full border border-dashed"
        >
          <EmptyHeader>
            <EmptyDescription>
              {{ t("draw.emptyDescription") }}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

        <Skeleton v-else-if="loading" class="flex-1 w-full h-full" />

        <div
          v-else-if="latestImage"
          class="flex h-full flex-col items-center justify-center gap-4 p-6"
        >
          <img
            :src="latestImage.image"
            :alt="latestImage.prompt"
            class="max-h-[60vh] max-w-full rounded-lg border object-contain shadow"
          />
          <div class="max-w-lg text-center">
            <p class="line-clamp-2 text-sm">{{ latestImage.prompt }}</p>
            <p class="text-xs text-muted-foreground">
              {{ latestImage.model }}
              <template v-if="latestImage.width && latestImage.height">
                · {{ latestImage.width }}×{{ latestImage.height }}
              </template>
              <template v-if="latestImage.seed">
                · seed {{ latestImage.seed }}
              </template>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
