// Text-to-image state: the generation options the user tweaks and the gallery
// of generated images.
//
// A Pinia store because the gallery is rendered from two places (the sidebar
// list and the image view) and must survive route changes; the gallery itself
// is persisted with VueUse's `useStorage`.

import { defineStore } from "pinia";
import { ref } from "vue";
import { throttleFilter, useStorage } from "@vueuse/core";
import { defaultOptions, setDefaults } from "@/composables/chat-defaults";
import { useSyncStore } from "@/stores/sync";
import {
  FREE_MODEL_BY_NAME,
  FREE_TEXT_GENERATION_MODELS,
  FREE_TEXT_TO_IMAGE_MODELS,
} from "@shared/generated/models";
import {
  acceptsParam,
  getBounds,
  type ParamBounds,
} from "@shared/generated/traits";
import { SYNC_SOFT_LIMIT_BYTES, softLimitMessage } from "@shared/sync";
import type { ImageRequest, ImageResult } from "@shared/api";
import type { GalleryItem } from "@shared/draw";
import { readApiError } from "@/lib/api-error";
import { t } from "@/lib/i18n";
import { toastError } from "@/lib/toast";
import { autoTitle, generateTitle } from "@/lib/titles";

const GALLERY_KEY = "draw:gallery:v1";

/** Re-exported for consumers that already import it from this module. */
export type { GalleryItem };

/** Per-page generation options the user tweaks (persisted as defaults). */
export interface DrawOptions {
  model: string;
  /**
   * Requested output size. Optional because Cloudflare never marks width/height
   * required and some models (FLUX) don't accept them at all — `undefined` means
   * "let the model choose its own default".
   */
  width?: number;
  height?: number;
  numSteps?: number;
  guidance?: number;
}

/**
 * Resolve the initial model. A stored default may name a model that has since
 * been removed from the free tier; fall back to the product default in that
 * case rather than starting the app with an unusable selection.
 */
function resolveInitialModel(): string {
  const stored = defaultOptions.drawModel;
  if (stored && FREE_MODEL_BY_NAME.has(stored)) return stored;
  return FREE_TEXT_TO_IMAGE_MODELS[0]?.name ?? "";
}

/**
 * Clamp to declared bounds. Bounds come from Cloudflare's JSON Schemas, which
 * declare `minimum` and `maximum` independently — a property may have only one
 * of them. Missing bounds are treated as unbounded on that side.
 */
function clampNum(value: number, bounds?: ParamBounds): number {
  if (!bounds) return value;
  const min = bounds.min ?? Number.NEGATIVE_INFINITY;
  const max = bounds.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, value));
}

export const useDrawStore = defineStore("draw", () => {
  const sync = useSyncStore();

  /**
   * A reactive ref backed by localStorage. `throttleFilter(300)` batches rapid
   * writes (e.g. clearing then re-adding during bulk operations) and uses a
   * deep watcher internally, so mutating `gallery.unshift(...)` or reassigning
   * the array both persist automatically.
   */
  const gallery = useStorage<GalleryItem[]>(GALLERY_KEY, [], undefined, {
    eventFilter: throttleFilter(300),
  });

  const options = ref<DrawOptions>({
    model: resolveInitialModel(),
    numSteps: 20,
    guidance: 7.5,
  });

  const generating = ref(false);
  /**
   * Gallery items whose AI title is being generated. The sidebar shimmers those
   * titles, so a placeholder does not read as a finished title.
   */
  const titlesPendingIds = ref(new Set<string>());

  /** In-flight request, so the user can stop it. Transient, not app state. */
  let controller: AbortController | null = null;

  /**
   * Ask the draw default model for a title, marking `itemId` as pending for the
   * whole round trip so the sidebar shimmers its placeholder meanwhile.
   *
   * A title describes the prompt, not the image, so this is deliberately able
   * to run while the image is still generating — callers start it early.
   */
  async function generateItemTitle(
    itemId: string,
    subject: string,
  ): Promise<string | null> {
    const model = defaultOptions.model || FREE_TEXT_GENERATION_MODELS[0]?.name;
    if (!model) return null;

    titlesPendingIds.value.add(itemId);
    try {
      return await generateTitle(model, subject);
    } finally {
      titlesPendingIds.value.delete(itemId);
    }
  }

  // -------------------------------------------------------------------------
  // Options
  // -------------------------------------------------------------------------

  function setDrawOptions(patch: Partial<DrawOptions>): void {
    Object.assign(options.value, patch);
  }

  /**
   * Persist the selected draw model through the shared defaults pipeline, and
   * re-clamp the current numeric options to the new model's schema so a stored
   * value (e.g. a high step count) never lingers out of range. An unset
   * width/height stays unset — the model's own default is used instead.
   */
  function setDrawModel(model: string): void {
    options.value.model = model;
    const current = options.value;

    if (current.width !== undefined) {
      current.width = clampNum(current.width, getBounds(model, "width"));
    }
    if (current.height !== undefined) {
      current.height = clampNum(current.height, getBounds(model, "height"));
    }
    if (current.numSteps !== undefined) {
      const stepsB = getBounds(model, "num_steps") ?? getBounds(model, "steps");
      if (stepsB) current.numSteps = clampNum(current.numSteps, stepsB);
    }
    if (current.guidance !== undefined) {
      const guidanceB = getBounds(model, "guidance");
      if (guidanceB) current.guidance = clampNum(current.guidance, guidanceB);
    }

    setDefaults({ drawModel: model });
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  /** Cancel an in-flight generation (safe to call when idle). */
  function stopGenerating(): void {
    controller?.abort();
    generating.value = false;
  }

  /**
   * Generate an image from the current options + prompt. Pushes the result into
   * the persisted gallery on success.
   *
   * The payload only includes parameters the selected model accepts; numeric
   * values are clamped to the model's declared bounds before sending, so clients
   * can't transit an out-of-range step/width/height/guidance.
   */
  async function generateImage(
    prompt: string,
    negativePrompt?: string,
  ): Promise<void> {
    const { model, width, height, numSteps, guidance } = options.value;

    // The whole history shares one KV entry, so refuse to grow it past the
    // safety margin instead of letting the upload fail and silently stop
    // syncing. The server enforces the same limit against the size actually
    // stored in KV.
    const usedBytes = sync.refreshBytes();
    if (usedBytes >= SYNC_SOFT_LIMIT_BYTES) {
      toastError(t("draw.notEnoughSpaceTitle"), softLimitMessage(usedBytes));
      return;
    }

    generating.value = true;
    controller = new AbortController();

    const payload: ImageRequest = { model, prompt };

    // Only forward a size the user explicitly set *and* the model accepts. An
    // omitted size lets Workers AI fall back to the model's own default instead
    // of us inventing one.
    if (width !== undefined && acceptsParam(model, "width")) {
      payload.width = clampNum(width, getBounds(model, "width"));
    }
    if (height !== undefined && acceptsParam(model, "height")) {
      payload.height = clampNum(height, getBounds(model, "height"));
    }
    if (negativePrompt && acceptsParam(model, "negative_prompt")) {
      payload.negativePrompt = negativePrompt;
    }
    if (numSteps !== undefined) {
      // `num_steps` and `steps` are two names for the same knob across model
      // families. Emit whichever the model declares; never both.
      if (acceptsParam(model, "num_steps")) {
        payload.numSteps = clampNum(numSteps, getBounds(model, "num_steps"));
      } else if (acceptsParam(model, "steps")) {
        payload.numSteps = clampNum(numSteps, getBounds(model, "steps"));
      }
    }
    if (guidance !== undefined && acceptsParam(model, "guidance")) {
      payload.guidance = clampNum(guidance, getBounds(model, "guidance"));
    }

    // Naming the image does not depend on the image, so the title is requested
    // alongside the generation rather than after it. The item only reaches the
    // gallery once the image is back, which is where the title gets applied.
    const itemId = crypto.randomUUID();
    const title = generateItemTitle(itemId, prompt);

    try {
      const res = await fetch("/api/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        // The server's reason (quota, NSFW, ...) is more useful than a status.
        throw new Error((await readApiError(res)).message);
      }
      const data = (await res.json()) as ImageResult;

      const item: GalleryItem = {
        id: itemId,
        title: autoTitle(prompt),
        titleSource: "fallback",
        prompt,
        negativePrompt,
        model: data.model,
        // The server sniffs the real output size; it is absent only when the
        // image header could not be parsed.
        width: data.width,
        height: data.height,
        seed: data.seed,
        image: data.image,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      gallery.value.unshift(item);

      const generatedTitle = await title;
      // Write through the gallery, like `renameGalleryItem` does: the object
      // pushed above is not the proxy the view and the storage watcher observe,
      // so mutating it would neither re-render nor persist.
      const stored = gallery.value.find((entry) => entry.id === itemId);
      if (generatedTitle && stored && stored.titleSource !== "user") {
        stored.title = generatedTitle;
        stored.titleSource = "ai";
        stored.updatedAt = Date.now();
      }
      onGenerationSuccessFn.value();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toastError(t("common.stopped"), t("common.stoppedByYou"), {
          duration: 4_000,
        });
      } else {
        toastError(
          t("draw.generationFailed"),
          err instanceof Error ? err.message : String(err),
        );
      }
    } finally {
      controller = null;
      generating.value = false;
    }
  }

  function renameGalleryItem(id: string, title: string): void {
    const item = gallery.value.find((entry) => entry.id === id);
    const nextTitle = autoTitle(title);
    if (!item || !nextTitle) return;
    item.title = nextTitle;
    item.titleSource = "user";
    item.updatedAt = Date.now();
  }

  /** On generation success */
  const onGenerationSuccessFn = ref<() => void>(() => {});
  function onGenerationSuccess(fn: () => void): void {
    onGenerationSuccessFn.value = fn;
  }

  // -------------------------------------------------------------------------
  // Gallery mutations
  // -------------------------------------------------------------------------

  /** Remove a single item from the persisted gallery. */
  function deleteGalleryItem(id: string): void {
    gallery.value = gallery.value.filter((g) => g.id !== id);
    // Tombstone it so another device that still holds a copy doesn't resurrect it.
    sync.recordDeletion(id);
  }

  /** Clear the whole gallery. */
  function clearGallery(): void {
    for (const item of gallery.value) {
      sync.recordDeletion(item.id);
    }
    gallery.value = [];
  }

  return {
    gallery,
    options,
    generating,
    titlesPendingIds,
    setDrawOptions,
    setDrawModel,
    stopGenerating,
    generateImage,
    deleteGalleryItem,
    renameGalleryItem,
    clearGallery,
    onGenerationSuccess,
  };
});
