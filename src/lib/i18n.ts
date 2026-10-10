import { match } from "@formatjs/intl-localematcher";
import { createI18n } from "vue-i18n";
import ar from "@/locales/ar.json";
import bn from "@/locales/bn.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";
import hi from "@/locales/hi.json";
import id from "@/locales/id.json";
import ja from "@/locales/ja.json";
import ptBR from "@/locales/pt-BR.json";
import ptPT from "@/locales/pt-PT.json";
import ru from "@/locales/ru.json";
import zhCN from "@/locales/zh-CN.json";
import zhHK from "@/locales/zh-HK.json";

// ---------------------------------------------------------------------------
// Locale schema and types
// ---------------------------------------------------------------------------

export const supportedLocales = [
  "ar",
  "bn",
  "de",
  "en",
  "es",
  "fr",
  "hi",
  "id",
  "ja",
  "pt-BR",
  "pt-PT",
  "ru",
  "zh-CN",
  "zh-HK",
] as const;

export type Locale = (typeof supportedLocales)[number];
export type LocaleSetting = "auto" | Locale;
export type Direction = "ltr" | "rtl";

type MessageSchema = typeof en;

// Only paths that resolve to string leaves are valid translation keys.
type StringLeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, unknown>
      ? `${K}.${StringLeafPaths<T[K]>}`
      : never;
}[keyof T & string];

export type MessageKey = StringLeafPaths<MessageSchema>;

export type MessageParams =
  Record<string, string | number> | Array<string | number>;

// Extend Vue I18n's global message schema so useI18n() can infer
// translation keys from the English master locale.
declare module "vue-i18n" {
  export interface DefineLocaleMessage extends MessageSchema {}
}

// ---------------------------------------------------------------------------
// Locale utilities
// ---------------------------------------------------------------------------

/** True when value is a valid locale preference (guards persisted data). */
export function isLocaleSetting(value: unknown): value is LocaleSetting {
  return (
    value === "auto" ||
    (typeof value === "string" &&
      (supportedLocales as readonly string[]).includes(value))
  );
}

/** Resolve the browser's preferred supported locale. */
export function resolveBrowserLocale(): Locale {
  return match(
    navigator.languages.length > 0 ? navigator.languages : [navigator.language],
    [...supportedLocales],
    "en",
  ) as Locale;
}

/**
 * Infer the natural writing direction from the locale's internationalization
 * data. Requires Intl.Locale.prototype.getTextInfo() support.
 */
export function dirForLocale(locale: Locale): Direction {
  const localeInfo = new Intl.Locale(locale) as Intl.Locale & {
    getTextInfo(): { direction: Direction };
  };

  return localeInfo.getTextInfo().direction;
}

// ---------------------------------------------------------------------------
// Vue I18n
// ---------------------------------------------------------------------------

// Missing and fallback warnings are enabled explicitly so incomplete locale
// files and incorrect translation keys remain visible during development.
const i18n = createI18n<MessageSchema, Locale, false>({
  legacy: false,
  locale: resolveBrowserLocale(),
  fallbackLocale: "en",
  messages: {
    ar,
    bn,
    de,
    en,
    es,
    fr,
    hi,
    id,
    ja,
    "pt-BR": ptBR,
    "pt-PT": ptPT,
    ru,
    "zh-CN": zhCN,
    "zh-HK": zhHK,
  },
});

/** The plugin instance — install in main.ts for useI18n(). */
export { i18n };

/** The locale currently in effect. */
export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale;
}

/** The direction for the currently active locale. */
export function currentDirection(): Direction {
  return dirForLocale(currentLocale());
}

/**
 * Switch the active language and keep <html lang> and <html dir> in sync.
 * Called by the preferences store.
 */
export function applyLocale(setting: LocaleSetting): Locale {
  const locale = setting === "auto" ? resolveBrowserLocale() : setting;

  i18n.global.locale.value = locale;

  document.documentElement.lang = locale;
  document.documentElement.dir = dirForLocale(locale);

  return locale;
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

/**
 * Translate a compile-time checked key.
 *
 * For components, prefer Vue I18n's useI18n(). This helper is for modules
 * without a component instance, such as stores and composables.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return (
    Array.isArray(params)
      ? i18n.global.t(key, params)
      : i18n.global.t(key, params ?? {})
  ) as string;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Human-readable language name in the current app language.
 * Falls back to the locale tag if Intl.DisplayNames cannot provide a name.
 */
export function languageLabel(locale: Locale): string {
  try {
    return (
      new Intl.DisplayNames([currentLocale()], {
        type: "language",
      }).of(locale) ?? locale
    );
  } catch {
    return locale;
  }
}

/** Full date + time in the app locale. */
export function formatDateTime(value: string | number | Date): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** A number in the app locale. Nullish values and NaN render as empty. */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";

  return new Intl.NumberFormat(currentLocale()).format(value);
}

/**
 * Format a byte count in mebibytes (MiB).
 * Uses binary conversion: 1 MiB = 1,048,576 bytes.
 */
const BYTES_PER_MEBIBYTE = 1024 * 1024;

/** Format a byte count in mebibytes (MiB). */
export function formatMebibytes(bytes: number): string {
  const value = new Intl.NumberFormat(currentLocale(), {
    maximumFractionDigits: 1,
  }).format(bytes / BYTES_PER_MEBIBYTE);

  return `${value} MiB`;
}

/** Short relative timestamp, such as "42 sec. ago" or "yesterday". */

export function formatRelativeTime(
  timestamp: number,
  now = Date.now(),
): string {
  const relativeTime = new Intl.RelativeTimeFormat(currentLocale(), {
    numeric: "auto",
    style: "narrow",
  });

  const seconds = (timestamp - now) / 1000;
  const abs = Math.abs(seconds);

  if (abs < 60) return relativeTime.format(Math.round(seconds), "second");
  if (abs < 3600)
    return relativeTime.format(Math.round(seconds / 60), "minute");
  if (abs < 86400)
    return relativeTime.format(Math.round(seconds / 3600), "hour");
  return relativeTime.format(Math.round(seconds / 86400), "day");
}
