// Shared text-to-image types, mirrored between the client and the server
// (`@shared/draw`). The type is derived from the schema so `sync.ts` can reuse
// the same shape without a second field list drifting out of date.

import z from "zod";

/** A single generated image, as persisted in the local gallery / sync state. */
export const galleryItemSchema = z.object({
  id: z.string().min(1),
  /** Short user-facing name; older records fall back to `prompt`. */
  title: z.string().optional(),
  /** Fallback, AI-generated, or user-owned. */
  titleSource: z.enum(["fallback", "ai", "user"]).optional(),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  model: z.string(),
  /**
   * Actual output size, sniffed from the image header. `undefined` when the
   * format was not a readable PNG/JPEG — consumers must treat it as "unknown",
   * never as a request parameter.
   */
  width: z.number().optional(),
  height: z.number().optional(),
  seed: z.number().optional(),
  /** Data URL (e.g. `data:image/png;base64,...`) ready for an `<img>` src. */
  image: z.string(),
  createdAt: z.number(),
  /** Last metadata mutation, used to propagate renames through sync. */
  updatedAt: z.number().optional(),
});
export type GalleryItem = z.infer<typeof galleryItemSchema>;
