// Reads user-selected files into the inline `Attachment` shape the wire schema
// carries, enforcing the size limit before the data ever reaches the store. The
// limits and MIME parsing are shared (`@shared/attachments`), so the client and
// the Worker agree on what is acceptable.
//
// Only images are supported: Cloudflare exposes no audio/video input capability
// anywhere, so offering it would fail at inference. See shared/attachments.ts.
import {
  ATTACHMENTS_MAX_PER_MESSAGE,
  ATTACHMENT_MAX_BYTES,
  isImageMimeType,
  parseDataUrl,
} from "@shared/attachments";
import type { Attachment } from "@shared/chat";

export interface AttachmentReadError {
  fileName: string;
  message: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Turn files into image attachments, skipping (and reporting) any that fail a
 * limit. The caller decides how to surface `errors`; valid files are always
 * returned.
 *
 * `existing` is the count already on the message, so a batch that would exceed
 * the per-message cap is trimmed rather than rejected wholesale.
 */
export async function readAttachments(
  files: readonly File[],
  existing: number,
): Promise<{ attachments: Attachment[]; errors: AttachmentReadError[] }> {
  const attachments: Attachment[] = [];
  const errors: AttachmentReadError[] = [];

  for (const file of files) {
    if (existing + attachments.length >= ATTACHMENTS_MAX_PER_MESSAGE) {
      errors.push({
        fileName: file.name,
        message: `At most ${ATTACHMENTS_MAX_PER_MESSAGE} attachments per message.`,
      });
      continue;
    }
    if (!isImageMimeType(file.type)) {
      errors.push({
        fileName: file.name,
        message: "Only images are supported.",
      });
      continue;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      errors.push({
        fileName: file.name,
        message: `File is larger than ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`,
      });
      continue;
    }

    try {
      const dataUrl = await readAsDataUrl(file);
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) {
        errors.push({ fileName: file.name, message: "Could not read file." });
        continue;
      }
      attachments.push({
        id: crypto.randomUUID(),
        dataUrl,
        mimeType: parsed.mimeType,
        name: file.name,
      });
    } catch {
      errors.push({ fileName: file.name, message: "Could not read file." });
    }
  }

  return { attachments, errors };
}
