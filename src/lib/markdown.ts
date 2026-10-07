// Markdown → marked → hooks (AST math + code-block extraction) → DOMPurify.
// The Marked instance and extensions are configured once; only the per-render
// context changes. Parsing is synchronous, so the shared context can't interleave.
import { Lexer, Marked, type HooksObject, type Token, type TokensList } from "marked";
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
type ThemeName = (typeof THEMES)[keyof typeof THEMES];
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

/** Structured code-block data; the UI is owned by Vue, never by HTML strings here. */
export interface CodeBlockData {
  language: string;
  code: string;
  /** Sanitized Shiki HTML, rendered via v-html in <CodeBlock/>. */
  highlightedHtml: string;
}

export interface RenderedMarkdown {
  html: string;
  codeBlocks: CodeBlockData[];
}

/** Inert marker swapped for a mounted <CodeBlock/>; the only custom element the sanitizer allows. */
function codeBlockMarker(index: number): string {
  return `<code-block data-block="${index}"></code-block>`;
}

/** First whitespace-delimited token of a language tag, lowercased ("ts title=x" → "ts"). */
function firstLangTag(value: string): string {
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

/** Collect fenced-code langs via AST (robust against backticks/math in code). */
function findCodeLangs(source: string): string[] {
  try {
    const tokens = Lexer.lex(source);
    const langs = new Set<string>();

    const walk = (tokens: Token[]) => {
      for (const t of tokens) {
        if (t.type === "code" && t.lang) {
          langs.add(firstLangTag(t.lang));
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

/** Merge escape/text tokens between \(...\) or \[...\] into KaTeX HTML.
 *  Code spans/fences are separate token types; unbalanced delimiters stay literal. */
function transformInlineMath(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const open = tokens[i];
    const isOpen =
      open.type === "escape" && (open.raw === "\\(" || open.raw === "\\[");
    if (!isOpen) {
      out.push(open);
      i++;
      continue;
    }
    const display = open.raw === "\\[";
    const closeRaw = display ? "\\]" : "\\)";
    let math = "";
    let raw = open.raw;
    let j = i + 1;
    let closed = false;
    while (j < tokens.length) {
      const t = tokens[j];
      if (t.type === "escape" && t.raw === closeRaw) {
        raw += t.raw;
        closed = true;
        break;
      }
      if (t.type === "escape" || t.type === "text") {
        math += t.raw;
        raw += t.raw;
        j++;
      } else {
        // Structural token inside delimiters: leave the span literal.
        break;
      }
    }
    if (!closed) {
      out.push(open);
      i++;
      continue;
    }
    out.push({
      type: "html",
      raw,
      text: katex.renderToString(math, { ...KATEX_OPTIONS, displayMode: display }),
    } as Token);
    i = j + 1;
  }
  return out;
}

function transformMathDelimiters(tokens: Token[]): void {
  for (const token of tokens) {
    if ("tokens" in token && Array.isArray(token.tokens)) {
      if (token.type === "paragraph" || token.type === "heading") {
        token.tokens = transformInlineMath(token.tokens);
      } else {
        transformMathDelimiters(token.tokens);
      }
    }
  }
}

/** Mutable view of a `code` token so it can be turned into an `html` token. */
interface MutableToken {
  type: string;
  raw: string;
  text: string;
  lang?: string;
}

interface RenderContext {
  highlighter: Highlighter;
  theme: ThemeName;
  codeBlocks: CodeBlockData[];
}

/** Replace each code token with KaTeX (latex/math/tex) or an inert marker, collecting block data. */
function collectCodeBlocks(tokens: Token[], ctx: RenderContext): void {
  for (const token of tokens) {
    if (token.type === "code") {
      const code = token as unknown as MutableToken;
      const normalized = firstLangTag(code.lang ?? "") || "text";

      if (normalized === "latex" || normalized === "math" || normalized === "tex") {
        try {
          code.type = "html";
          code.text = katex.renderToString(code.text, {
            ...KATEX_OPTIONS,
            displayMode: true,
          });
        } catch {
          // Fallback: plain block rendered by <CodeBlock/>.
          ctx.codeBlocks.push({
            language: "text",
            code: code.text,
            highlightedHtml: "",
          });
          code.type = "html";
          code.text = codeBlockMarker(ctx.codeBlocks.length - 1);
        }
        continue;
      }

      const supported = normalized === "text" || LOADABLE_LANGS.has(normalized);
      let highlighted: string;
      try {
        highlighted = ctx.highlighter.codeToHtml(code.text, {
          lang: supported ? normalized : "text",
          theme: ctx.theme,
          defaultColor: false,
        });
      } catch {
        highlighted = ctx.highlighter.codeToHtml(code.text, {
          lang: "text",
          theme: ctx.theme,
        });
      }
      // Sanitize Shiki output so one trust boundary covers everything reaching <CodeBlock/>.
      ctx.codeBlocks.push({
        language: normalized,
        code: code.text,
        highlightedHtml: DOMPurify.sanitize(highlighted, {
          USE_PROFILES: { html: true },
        }),
      });
      code.type = "html";
      code.text = codeBlockMarker(ctx.codeBlocks.length - 1);
    } else if ("tokens" in token && Array.isArray(token.tokens)) {
      collectCodeBlocks(token.tokens, ctx);
    }
  }
}

// Per-render state for the hook; parse is synchronous, so no await can
// interleave between assignment and the hook reading it.
let renderContext: RenderContext | null = null;

function processAllTokens(tokens: Token[] | TokensList): Token[] | TokensList {
  const ctx = renderContext;
  if (!ctx) return tokens;
  transformMathDelimiters(tokens);
  collectCodeBlocks(tokens, ctx);
  return tokens;
}

const hooks: HooksObject = { processAllTokens };

const marked = new Marked({ gfm: true, breaks: true });
marked.use(markedKatex(KATEX_OPTIONS));
marked.use({ hooks });

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
  const codeBlocks: CodeBlockData[] = [];
  renderContext = { highlighter, theme, codeBlocks };
  try {
    const result = marked.parse(source);
    const raw = typeof result === "string" ? result : await result;

    // Allow KaTeX SVG/MathML plus the code-block marker; nothing else custom passes.
    const html = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      CUSTOM_ELEMENT_HANDLING: {
        tagNameCheck: (tag) => tag === "code-block",
        attributeNameCheck: (attr) => attr === "data-block",
      },
    });
    return { html, codeBlocks };
  } finally {
    renderContext = null;
  }
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
