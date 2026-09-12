// i18n for the client (en / zh / de), with an "auto" (browser) option.
//
// Backed by vue-i18n (Composition API). `en` is the master message schema and
// `MessageKey` is a recursive dotted-path type over it, so `t()` keys are
// compile-time checked (a mistyped key fails typecheck).
//
// The *preference* (auto/en/zh/de) lives in the preferences store
// (`stores/preferences.ts`); this module owns the vue-i18n instance, the
// global `t()` helper (for stores and composables, which have no component
// scope) and the locale-aware formatting helpers.

import { match } from "@formatjs/intl-localematcher";
import { createI18n } from "vue-i18n";
import en from "@/locales/en.json";
import de from "@/locales/de.json";
import zh from "@/locales/zh.json";

export type Locale = "en" | "de" | "zh";
export type LocaleSetting = "auto" | Locale;

export const supportedLocales = ["en", "de", "zh"] as const;

/** True when `value` is a valid locale preference (guards persisted data). */
export function isLocaleSetting(value: unknown): value is LocaleSetting {
  return (
    value === "auto" ||
    (typeof value === "string" && supportedLocales.includes(value as Locale))
  );
}

/** Resolve the browser's preferred supported locale (the "auto" setting). */
export function resolveBrowserLocale(): Locale {
  return match(
    navigator.languages ?? [navigator.language],
    [...supportedLocales],
    "en",
  ) as Locale;
}

// Recursive dotted-path type over the (nested) en locale: yields keys like
// "common.settings" or "chat.effort.high".
type Paths<T, P extends string = ""> = {
  [K in keyof T]: T[K] extends string
    ? P extends ""
      ? `${K & string}`
      : `${P}.${K & string}`
    : Paths<T[K], P extends "" ? `${K & string}` : `${P}.${K & string}`>;
}[keyof T];

export type MessageKey = Paths<typeof en>;

export type MessageParams = Record<string, string | number> | Array<string | number>;

// Missing keys fall back to `en`, then to the raw key. Correctness is enforced
// by the `MessageKey` type instead of runtime warnings (which would spam the
// console for the locale files that are still being translated).
const i18n = createI18n({
  legacy: false,
  locale: resolveBrowserLocale(),
  fallbackLocale: "en",
  messages: { en, de, zh },
  missingWarn: false,
  fallbackWarn: false,
});

/** The plugin instance — installed in `main.ts` for `useI18n()` in components. */
export { i18n };

/** The locale currently in effect (reactive). */
export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale;
}

/**
 * Switch the active language and keep `<html lang>` in sync.
 * Called by the preferences store; components re-render automatically.
 */
export function applyLocale(setting: LocaleSetting): Locale {
  const locale = setting === "auto" ? resolveBrowserLocale() : setting;
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  return locale;
}

/**
 * Translate a (compile-time checked) key.
 *
 * For components prefer vue-i18n's `useI18n({ useScope: "global" })`; this
 * helper exists for modules without a component instance (stores, composables)
 * and is equally reactive because it reads the global locale ref.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  // Split the union explicitly: vue-i18n's overloads distinguish a named
  // record ({count}) from a positional list ([count]).
  return (
    Array.isArray(params)
      ? i18n.global.t(key, params)
      : i18n.global.t(key, params ?? {})
  ) as string;
}

/**
 * Human-readable name of a language, written in the *current* app language
 * (e.g. "German" / "Deutsch" / "德语"). Falls back to the tag itself when the
 * runtime has no display name for it.
 */
export function languageLabel(locale: Locale): string {
  try {
    const names = new Intl.DisplayNames([currentLocale()], { type: "language" });
    return names.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

/** Full date + time in the app locale — used for the About panel's build time. */
export function formatDateTime(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Short relative stamp ("42s ago" / "3m ago" / "2h ago" / "4d ago"). */
export function formatRelativeTime(
  timestamp: number | null,
  now: number = Date.now(),
): string {
  if (!timestamp) return t("common.notYet");
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return t("common.justNow");
  if (seconds < 60) return t("common.secondsAgo", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("common.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("common.hoursAgo", { count: hours });
  return t("common.daysAgo", { count: Math.round(hours / 24) });
}
