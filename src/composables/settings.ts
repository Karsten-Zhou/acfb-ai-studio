// Client-side persistence of default chat options.
//
// These are the *defaults* used for new conversations: the selected model,
// reasoning effort, and generation params. The user can change them freely
// and we remember them across reloads. Conversations themselves are handled by
// `composables/chat.ts`; this module owns just the defaults.

import { reactive } from "vue";
import { useStorage, throttleFilter } from "@vueuse/core";
import type { DefaultChatOptions } from "@shared/chat";

const STORAGE_KEY = "defaults:v1";

/**
 * Shape of the persisted defaults. Aliased to the shared `DefaultChatOptions`
 * so the sync payload can describe the same object without a second field list
 * drifting out of date.
 */
export type DefaultOptionsState = DefaultChatOptions;

/** Defaults when nothing has been persisted yet. */
function fallbackDefaults(): DefaultOptionsState {
  return {
    model: "",
    reasoningEffort: "medium",
    params: { temperature: 0.7, topP: 0.9, stream: true },
  };
}

/**
 * Reactive ref backed by localStorage.
 *
 * - `mergeDefaults: true` deep-merges the persisted blob over the fallback,
 *   so fields added to `DefaultOptionsState` in future versions inherit their
 *   default when reading an older persisted blob.
 * - `throttleFilter(150)` keeps the same write cadence as the previous
 *   debounced watcher (rapid changes during a picker drag are batched).
 * - `useStorage` also listens for `storage` events, so defaults stay in sync
 *   across tabs for free.
 */
const persisted = useStorage<DefaultOptionsState>(
  STORAGE_KEY,
  fallbackDefaults(),
  undefined,
  {
    mergeDefaults: true,
    eventFilter: throttleFilter(150),
  },
);

/**
 * A `ref()` whose value is an object exposes that value as a Vue reactive
 * proxy, so `reactive(persisted.value)` returns the same proxy. Exporting it
 * this way lets existing call sites keep using `defaultOptions.model` and
 * `Object.assign(defaultOptions, ...)`; mutations are tracked by
 * `useStorage`'s internal deep watcher and written back to localStorage.
 */
export const defaultOptions = reactive<DefaultOptionsState>(persisted.value);

/** Merge a partial update into the defaults (e.g. `{ model }` from a picker). */
export function setDefaults(patch: Partial<DefaultOptionsState>) {
  Object.assign(defaultOptions, patch);
}
