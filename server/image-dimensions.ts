// Output-size sniffing for images returned by Workers AI.
//
// Workers AI never reports the size of the image it produced, and the request
// may not even carry one (FLUX takes no width/height, and both are optional
// everywhere), so the true size is read back from the image header.
// `image-size` parses only the header — it never decodes pixel data — so this
// costs a few microseconds and is safe to run on every response.

import { imageSize } from "image-size";

export interface ImageDimensions {
  width?: number;
  height?: number;
}

/** Enough base64 to cover a PNG's IHDR (offset 16) and a typical JPEG SOF. */
const SNIFF_BASE64_CHARS = 4096;

/** Dimensions of raw image bytes; `{}` when the format is unknown or corrupt. */
export function dimensionsOfBytes(bytes: Uint8Array): ImageDimensions {
  try {
    const { width, height } = imageSize(bytes);
    return width && height ? { width, height } : {};
  } catch {
    // Not worth failing the request over: report "size unknown" instead.
    return {};
  }
}

/** Dimensions of a base64 image body (the part after `data:<type>;base64,`). */
export function dimensionsOfBase64(base64: string): ImageDimensions {
  try {
    const head = dimensionsOfBytes(
      base64ToBytes(base64.slice(0, SNIFF_BASE64_CHARS)),
    );
    // A JPEG's SOF marker can sit past the prefix (large EXIF); fall back to
    // the full payload only when the cheap attempt found nothing.
    return head.width !== undefined
      ? head
      : dimensionsOfBytes(base64ToBytes(base64));
  } catch {
    return {};
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
