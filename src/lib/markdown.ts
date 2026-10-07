// Markdown rendering with code syntax highlighting and sanitization.
import { Marked, Lexer, type Token } from "marked";
import markedKatex from "marked-katex-extension";
import type { MarkedKatexOptions } from "marked-katex-extension";
import katex from "katex";
import {
  createHighlighter,
  type Highlighter,
  type ThemeRegistrationRaw,
} from "shiki";
import DOMPurify from "dompurify";

import dark2026Raw from "../shikithemes/2026-dark.json";
import light2026Raw from "../shikithemes/2026-light.json";

const THEMES = { dark: "2026 Dark", light: "2026 Light" } as const;
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
async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [dark2026, light2026],
      langs: [...PRELOADED_LANGS],
    });
  }
  return highlighterPromise;
}

const LOADABLE_LANGS = new Set<string>(PRELOADED_LANGS);

/**
 * Structured representation of a fenced code block. The renderer only emits
 * language/code/highlighting data plus an inert marker element; the actual UI
 * (<CodeBlock/>) is owned by Vue, never by HTML strings in this module.
 */
export interface CodeBlockData {
  language: string;
  code: string;
  /** Shiki-generated HTML; sanitized here, rendered by <CodeBlock/> via v-html. */
  highlightedHtml: string;
}

export interface RenderedMarkdown {
  html: string;
  codeBlocks: CodeBlockData[];
}

/**
 * Inert marker for one code block, replaced with a mounted <CodeBlock/>
 * component by MarkdownContent.vue after v-html rendering. It is the only
 * custom element the sanitizer allows; a forged marker only swaps in data
 * from this render pass and can never execute anything.
 */
function codeBlockMarker(index: number): string {
  return `<code-block data-block="${index}"></code-block>`;
}

/**
 * Extract fenced-code language tags from markdown source using AST.
 * This is robust against code blocks containing backticks or math symbols.
 */
function findCodeLangs(source: string): string[] {
  try {
    const tokens = Lexer.lex(source);
    const langs = new Set<string>();

    const walk = (tokens: Token[]) => {
      for (const t of tokens) {
        if (t.type === "code" && t.lang) {
          langs.add(t.lang.toLowerCase().split(/\s+/)[0]);
        }
        if ("tokens" in t && Array.isArray(t.tokens)) {
          walk(t.tokens);
        }
      }
    };
    walk(tokens);
    return [...langs];
  } catch (e) {
    console.warn("Failed to parse markdown for language detection:", e);
    return [];
  }
}

// ==========================================
// Math Enhancements
// ==========================================

const KATEX_OPTIONS: MarkedKatexOptions = {
  throwOnError: false,
  strict: false,
  trust: false,
  output: "html",
  macros: {
    "\\RR": "\\mathbb{R}",
    "\\NN": "\\mathbb{N}",
    "\\ZZ": "\\mathbb{Z}",
    "\\QQ": "\\mathbb{Q}",
    "\\CC": "\\mathbb{C}",
    "\\abs": ["\\left| #1 \\right|", 1],
    "\\norm": ["\\left\\| #1 \\right\\|", 1],
  },
};

/**
 * Safely preprocess math delimiters \[ \] and \( \) into $$ and $.
 * Uses regex but safely ignores code blocks to prevent breaking LaTeX examples.
 */
function preprocessMathDelimiters(source: string): string {
  const codeBlockRegex = /(```[\s\S]*?```|`[^`\n]*`)/g;
  const parts = source.split(codeBlockRegex);

  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part; // Odd indices are code blocks, skip them

      // Convert \[ ... \] to $$ ... $$ (display math)
      part = part.replace(/\\\[([\s\S]+?)\\\]/g, "\n$$\n$1\n$$\n");
      // Convert \( ... \) to $ ... $ (inline math)
      part = part.replace(/\\\(([\s\S]+?)\\\)/g, "$ $1 $");
      return part;
    })
    .join("");
}

export async function renderMarkdown(
  source: string,
  isDark = true,
): Promise<RenderedMarkdown> {
  const highlighter = await getHighlighter();

  const toLoad = [...new Set(findCodeLangs(source))].filter(
    (l) => l !== "text" && !LOADABLE_LANGS.has(l),
  );
  await Promise.allSettled(
    toLoad.map((l) => highlighter.loadLanguage(l as never)),
  );
  toLoad.forEach((l) => LOADABLE_LANGS.add(l));

  const theme = isDark ? THEMES.dark : THEMES.light;

  // Collected during parse; the renderer emits inert markers referencing these.
  const codeBlocks: CodeBlockData[] = [];

  const marked = new Marked({
    renderer: {
      code({ text, lang }) {
        const normalized = lang?.toLowerCase() ?? "text";

        // Render latex/math/tex code blocks as display math
        if (
          normalized === "latex" ||
          normalized === "math" ||
          normalized === "tex"
        ) {
          try {
            return katex.renderToString(text, {
              ...KATEX_OPTIONS,
              displayMode: true,
            });
          } catch {
            // Fall back to a plain code block rendered by <CodeBlock/>.
            codeBlocks.push({
              language: "text",
              code: text,
              highlightedHtml: "",
            });
            return codeBlockMarker(codeBlocks.length - 1);
          }
        }

        const supported =
          normalized === "text" || LOADABLE_LANGS.has(normalized);
        let highlighted: string;
        try {
          highlighted = highlighter.codeToHtml(text, {
            lang: supported ? normalized : "text",
            theme,
            defaultColor: false,
          });
        } catch {
          highlighted = highlighter.codeToHtml(text, {
            lang: "text",
            theme,
          });
        }
        // Shiki output is escaped by construction; sanitize anyway to keep a
        // single trust boundary for everything that reaches <CodeBlock/>.
        codeBlocks.push({
          language: normalized,
          code: text,
          highlightedHtml: DOMPurify.sanitize(highlighted, {
            USE_PROFILES: { html: true },
          }),
        });
        return codeBlockMarker(codeBlocks.length - 1);
      },
    },
  });

  marked.use(markedKatex(KATEX_OPTIONS));
  marked.setOptions({ gfm: true, breaks: true });

  // 1. Preprocess delimiters safely
  const processedSource = preprocessMathDelimiters(source);

  // 2. Await parse to handle both sync and async extension returns
  const raw = await marked.parse(processedSource);

  // 3. Sanitize while allowing KaTeX's SVG and MathML, plus our code-block
  // marker (the only custom element allowed, so user HTML cannot forge one).
  const html = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: (tag) => tag === "code-block",
      attributeNameCheck: (attr) => attr === "data-block",
    },
  });

  return { html, codeBlocks };
}

const cache = new Map<string, { dark: boolean; result: RenderedMarkdown }>();
const MAX_CACHE = 200;
export async function cachedMarkdown(
  source: string,
  isDark = true,
): Promise<RenderedMarkdown> {
  const hit = cache.get(source);
  if (hit && hit.dark === isDark) return hit.result;
  const result = await renderMarkdown(source, isDark);
  cache.set(source, { dark: isDark, result });
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}
