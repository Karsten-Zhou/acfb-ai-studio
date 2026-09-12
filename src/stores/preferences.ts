// Cross-view user preferences: theme (light/dark/system) and language.
//
// Only genuinely global state lives here: both values are read by the app shell
// (sidebar, markdown renderer, `<html lang>`) and must survive route changes and
// reloads. Persistence goes through VueUse's `useStorage`, so the values are
// written to localStorage and (unlike a plain ref) stay in sync across tabs.

import { computed, watch } from "vue";
import { defineStore } from "pinia";
import { usePreferredDark, useStorage } from "@vueuse/core";
import {
  applyLocale,
  isLocaleSetting,
  resolveBrowserLocale,
  supportedLocales,
  type Locale,
  type LocaleSetting,
} from "@/lib/i18n";

export type ThemeSetting = "auto" | "light" | "dark";

interface PersistedPreferences {
  theme: ThemeSetting;
  locale: LocaleSetting;
}

const STORAGE_KEY = "preferences:v1";

/** Options offered by the language picker ("auto" is prepended by the UI). */
export const localeOptions = supportedLocales;

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "auto" || value === "light" || value === "dark";
}

function fallback(): PersistedPreferences {
  return { theme: "auto", locale: "auto" };
}

export const usePreferencesStore = defineStore("preferences", () => {
  const stored = useStorage<PersistedPreferences>(
    STORAGE_KEY,
    fallback(),
    undefined,
    { mergeDefaults: true },
  );

  // Writable computeds keep the persisted blob as the single source of truth
  // while still reading like plain reactive state (`store.theme = "dark"`).
  // Reads are validated: a hand-edited or foreign localStorage value must not
  // put the app in a state it cannot render.
  const theme = computed<ThemeSetting>({
    get: () => (isThemeSetting(stored.value.theme) ? stored.value.theme : "auto"),
    set: (value) => {
      stored.value = { ...stored.value, theme: value };
    },
  });

  const locale = computed<LocaleSetting>({
    get: () =>
      isLocaleSetting(stored.value.locale) ? stored.value.locale : "auto",
    set: (value) => {
      stored.value = { ...stored.value, locale: value };
    },
  });

  /**
   * The theme actually rendered. `usePreferredDark` is reactive, so "sync with
   * the system" keeps working while the app stays open.
   */
  const prefersDark = usePreferredDark();

  const isDark = computed(() =>
    theme.value === "auto" ? prefersDark.value : theme.value === "dark",
  );

  watch(
    isDark,
    (dark) => {
      document.documentElement.classList.toggle("dark", dark);
    },
    { immediate: true },
  );

  watch(locale, (setting) => applyLocale(setting), { immediate: true });

  /** The language in effect, with "auto" already resolved to a real locale. */
  const activeLocale = computed<Locale>(() =>
    locale.value === "auto" ? resolveBrowserLocale() : locale.value,
  );

  return { theme, locale, isDark, activeLocale };
});

/**
 * Boot the preferences: creating the store applies the persisted theme and
 * language to the document (see the immediate watchers above). Called from
 * `main.ts` before mount so the first paint already has the right theme.
 */
export function initPreferences(): void {
  usePreferencesStore();
}
