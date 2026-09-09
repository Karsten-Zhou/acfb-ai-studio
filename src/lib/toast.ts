import { toast, type Action } from "vue-sonner";

/**
 * Show a failure toast.
 *
 * Errors here are one-shot: they are shown and forgotten, so nothing is kept in
 * store state afterwards.
 */
export function toastError(
  title: string,
  message: string,
  options: { action?: Action; duration?: number } = {},
): void {
  toast.error(title, {
    description: message,
    closeButton: true,
    closeButtonPosition: "top-left",
    duration: options.duration ?? Infinity,
    action: options.action,
  });
}
