// Shared text-to-image types, mirrored between the client and the server
// (`@shared/draw`). Kept out of `src/composables/draw.ts` so the sync payload
// in `@shared/sync` can reference the same shape without importing client code.

/** A single generated image, as persisted in the local gallery / sync state. */
export interface GalleryItem {
  id: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  /**
   * Actual output size in pixels, sniffed from the generated image's header.
   * `undefined` when the format was not a readable PNG/JPEG — consumers must
   * treat it as "unknown", never as a request parameter.
   */
  width?: number;
  height?: number;
  seed?: number;
  /** Data URL (e.g. `data:image/png;base64,...`) ready for an `<img>` src. */
  image: string;
  createdAt: number;
}
