// Shiki-based code highlighting, shared by the Markdown pipeline.
//
// This module owns the highlighter singleton, the Shiki themes, the set of
// loaded languages, and the HTML sanitization boundary. It lives on its own so
// that <CodeBlock/> stays a purely presentational component (no async Shiki
// work inside Vue render) and markdown.ts remains a Markdown -> HTML concern.
import {
  createHighlighter,
  type Highlighter,
  type ThemeRegistrationRaw,
} from "shiki";
import DOMPurify from "dompurify";

import dark2026Raw from "../shikithemes/2026-dark.json";
import light2026Raw from "../shikithemes/2026-light.json";

export type { Highlighter };

const THEMES = { dark: "2026 Dark", light: "2026 Light" } as const;
export type ThemeName = (typeof THEMES)[keyof typeof THEMES];

const dark2026 = dark2026Raw as ThemeRegistrationRaw;
const light2026 = light2026Raw as ThemeRegistrationRaw;

const PRELOADED_LANGS = [
  "text",
  "plaintext",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "vue",
  "html",
  "css",
  "json",
  "bash",
  "markdown",
  "python",
  "sql",
];

let highlighterPromise: Promise<Highlighter> | null = null;

/** Lazily create the shared Shiki highlighter (idempotent, cached). */
export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [dark2026, light2026],
      langs: [...PRELOADED_LANGS],
    });
  }
  return highlighterPromise;
}

const LOADABLE_LANGS = new Set<string>(PRELOADED_LANGS);

/** Map the app's light/dark flag onto the Shiki theme name. */
export function resolveTheme(isDark: boolean): ThemeName {
  return isDark ? THEMES.dark : THEMES.light;
}

/** First whitespace-delimited token of a language tag, lowercased ("ts title=x" -> "ts"). */
export function firstLangTag(value: string): string {
  let end = 0;
  while (
    end < value.length &&
    value[end] !== " " &&
    value[end] !== "\t" &&
    value[end] !== "\n"
  ) {
    end++;
  }
  return value.slice(0, end).toLowerCase();
}

/**
 * Ensure every requested language is available on the shared highlighter.
 * Unknown languages fail individually (Promise.allSettled) and fall back to
 * plain text at highlight time.
 */
export async function loadLanguages(langs: Iterable<string>): Promise<void> {
  const highlighter = await getHighlighter();
  const toLoad = [...new Set(langs)].filter(
    (l) => l !== "text" && !LOADABLE_LANGS.has(l),
  );
  await Promise.allSettled(
    toLoad.map((l) => highlighter.loadLanguage(l as never)),
  );
  toLoad.forEach((l) => LOADABLE_LANGS.add(l));
}

/**
 * Highlight `code` and return sanitized HTML for use with v-html.
 * Sanitizing here gives one trust boundary for everything reaching <CodeBlock/>.
 */
export function highlightCode(
  highlighter: Highlighter,
  code: string,
  language: string,
  theme: ThemeName,
): string {
  const supported = language === "text" || LOADABLE_LANGS.has(language);
  let highlighted: string;
  try {
    highlighted = highlighter.codeToHtml(code, {
      lang: supported ? language : "text",
      theme,
      defaultColor: false,
    });
  } catch {
    highlighted = highlighter.codeToHtml(code, {
      lang: "text",
      theme,
    });
  }
  return DOMPurify.sanitize(highlighted, { USE_PROFILES: { html: true } });
}
