// Text-to-image state management for the "Workers AI Draw" page.
//
// Mirrors `composables/chat.ts`: module-level reactive store so it survives
// route changes, plus a VueUse `useStorage`-backed gallery of generated images
// (prompt, model, size, seed, data URL) so results persist across reloads.

import { reactive } from "vue";
import { useStorage, throttleFilter } from "@vueuse/core";
import { defaultOptions, setDefaults } from "@/composables/settings";
import { recordDeletion, refreshBytes } from "@/composables/sync-state";
import {
  FREE_MODEL_BY_NAME,
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
import { toastError } from "@/lib/toast";

const GALLERY_KEY = "draw:gallery:v1";

/** Re-exported for consumers that already import it from this module. */
export type { GalleryItem };

/** Per-page generation options the user tweaks (persisted as defaults). */
export interface DrawOptions {
  model: string;
  /**
   * Requested output size. Optional because Cloudflare never marks width/
   * height required and some models (FLUX) don't accept them at all —
   * `undefined` means "let the model choose its own default".
   */
  width?: number;
  height?: number;
  numSteps?: number;
  guidance?: number;
}

interface DrawStoreState {
  options: DrawOptions;
  generating: boolean;
  gallery: GalleryItem[];
}

// ---------------------------------------------------------------------------
// Persistent reactive gallery via VueUse
// ---------------------------------------------------------------------------

/**
 * A reactive ref backed by localStorage. `throttleFilter(300)` batches rapid
 * writes (e.g. clearing then re-adding during bulk operations) and uses a
 * deep watcher internally, so mutating `gallery.unshift(...)` or reassigning
 * the array both persist automatically.
 */
const gallery = useStorage<GalleryItem[]>(GALLERY_KEY, [], undefined, {
  eventFilter: throttleFilter(300),
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

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

export const drawStore = reactive({
  options: {
    model: resolveInitialModel(),
    numSteps: 20,
    guidance: 7.5,
  },
  generating: false,
  gallery,
}) as DrawStoreState;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export function setDrawOptions(patch: Partial<DrawOptions>) {
  Object.assign(drawStore.options, patch);
}

/**
 * Persist the selected draw model through the shared defaults pipeline, and
 * re-clamp the current numeric options to the new model's schema so a stored
 * value (e.g. a high step count) never lingers out of range. An unset
 * width/height stays unset — the model's own default is used instead.
 */
export function setDrawModel(model: string) {
  drawStore.options.model = model;

  if (drawStore.options.width !== undefined) {
    drawStore.options.width = clampNum(
      drawStore.options.width,
      getBounds(model, "width"),
    );
  }
  if (drawStore.options.height !== undefined) {
    drawStore.options.height = clampNum(
      drawStore.options.height,
      getBounds(model, "height"),
    );
  }

  if (drawStore.options.numSteps !== undefined) {
    const stepsB = getBounds(model, "num_steps") ?? getBounds(model, "steps");
    if (stepsB) {
      drawStore.options.numSteps = clampNum(drawStore.options.numSteps, stepsB);
    }
  }

  if (drawStore.options.guidance !== undefined) {
    const guidanceB = getBounds(model, "guidance");
    if (guidanceB) {
      drawStore.options.guidance = clampNum(
        drawStore.options.guidance,
        guidanceB,
      );
    }
  }

  setDefaults({ drawModel: model });
}

// ---------------------------------------------------------------------------
// Abort + helpers
// ---------------------------------------------------------------------------

let controller: AbortController | null = null;

/** Cancel an in-flight generation (safe to call when idle). */
export function stopGenerating() {
  controller?.abort();
  drawStore.generating = false;
}

/**
 * Clamp to declared bounds. Bounds come from Cloudflare's JSON Schemas, which
 * declare `minimum` and `maximum` independently — a property may have only
 * one of them. Missing bounds are treated as unbounded on that side.
 */
function clampNum(value: number, bounds?: ParamBounds): number {
  if (!bounds) return value;
  const min = bounds.min ?? Number.NEGATIVE_INFINITY;
  const max = bounds.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate an image from the current options + prompt. Pushes the result into
 * the persisted gallery on success.
 *
 * The payload only includes parameters the selected model accepts; numeric
 * values are clamped to the model's declared bounds before sending, so clients
 * can't transit an out-of-range step/width/height/guidance.
 */
export async function generateImage(prompt: string, negativePrompt?: string) {
  const { model, width, height, numSteps, guidance } = drawStore.options;

  // The whole history shares one KV entry, so refuse to grow it past the safety
  // margin instead of letting the upload fail and silently stop syncing. The
  // server enforces the same limit against the size actually stored in KV.
  const usedBytes = refreshBytes();
  if (usedBytes >= SYNC_SOFT_LIMIT_BYTES) {
    toastError("Not enough sync space", softLimitMessage(usedBytes));
    return;
  }

  drawStore.generating = true;
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
      id: crypto.randomUUID(),
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
    };
    drawStore.gallery.unshift(item);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      toastError("Stopped", "Stopped by you.", { duration: 4_000 });
    } else {
      toastError(
        "Generation failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  } finally {
    controller = null;
    drawStore.generating = false;
  }
}

// ---------------------------------------------------------------------------
// Gallery mutations
// ---------------------------------------------------------------------------

/** Remove a single item from the persisted gallery. */
export function deleteGalleryItem(id: string) {
  drawStore.gallery = drawStore.gallery.filter((g) => g.id !== id);
  // Tombstone it so another device that still holds a copy doesn't resurrect it.
  recordDeletion(id);
}

/** Clear the whole gallery. */
export function clearGallery() {
  for (const item of drawStore.gallery) {
    recordDeletion(item.id);
  }
  drawStore.gallery = [];
}
