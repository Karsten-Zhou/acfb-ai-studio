// Markdown → marked → hooks (AST math + code-block extraction) → DOMPurify.
// Highlighting is NOT done here: fenced blocks are extracted as plain
// `{ language, code }` data and <CodeBlock/> owns Shiki. That keeps this module
// synchronous and lets <CodeBlock/> re-highlight only the block that changed
// (e.g. the one still streaming) instead of every fence on every render.
import {
  Marked,
  Renderer,
  type HooksObject,
  type Token,
  type TokensList,
} from "marked";
import markedKatex from "marked-katex-extension";
import type { MarkedKatexOptions } from "marked-katex-extension";
import katex from "katex";
import DOMPurify from "dompurify";

import { firstLangTag } from "./code-highlight";

/** Structured code-block data; highlighting is owned by <CodeBlock/>. */
export interface CodeBlockData {
  language: string;
  code: string;
}

export interface RenderedMarkdown {
  html: string;
  codeBlocks: CodeBlockData[];
}

/** Inert marker swapped for a mounted <CodeBlock/>; the only custom element the sanitizer allows. */
function codeBlockMarker(index: number): string {
  return `<code-block data-block="${index}"></code-block>`;
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
      text: katex.renderToString(math, {
        ...KATEX_OPTIONS,
        displayMode: display,
      }),
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
  codeBlocks: CodeBlockData[];
}

/** Replace each code token with KaTeX (latex/math/tex) or an inert marker, collecting block data. */
function collectCodeBlocks(tokens: Token[], ctx: RenderContext): void {
  for (const token of tokens) {
    if (token.type === "code") {
      const code = token as unknown as MutableToken;
      const normalized = firstLangTag(code.lang ?? "") || "text";

      if (
        normalized === "latex" ||
        normalized === "math" ||
        normalized === "tex"
      ) {
        try {
          code.type = "html";
          code.text = katex.renderToString(code.text, {
            ...KATEX_OPTIONS,
            displayMode: true,
          });
        } catch (error) {
          // Fallback: plain block rendered by <CodeBlock/>, so the user still
          // reads the source. Logged because malformed math is a real defect in
          // what the model produced, and it re-renders on every visit.
          console.debug(
            `[markdown] KaTeX could not render: ${code.text.slice(0, 80)}`,
            error,
          );
          ctx.codeBlocks.push({ language: "text", code: code.text });
          code.type = "html";
          code.text = codeBlockMarker(ctx.codeBlocks.length - 1);
        }
        continue;
      }

      ctx.codeBlocks.push({ language: normalized, code: code.text });
      code.type = "html";
      code.text = codeBlockMarker(ctx.codeBlocks.length - 1);
    } else if ("tokens" in token && Array.isArray(token.tokens)) {
      collectCodeBlocks(token.tokens, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Bidirectional text policy
//
// The browser implements the Unicode Bidirectional Algorithm; we never do.
// The only policy here is *where* direction is established:
//   - Independent leaf text blocks (paragraphs, headings) and list items and
//     tables carry dir="auto", so an Arabic block inside an LTR document (and
//     vice versa) resolves itself from its first strong character.
//   - Structural containers (blockquote, ul/ol) carry no direction and follow
//     the document/shell direction: their children with dir="auto" are
//     bidi-isolated, so dir="auto" on the container would see no strong
//     characters and the spec forces an LTR fallback.
//   - Leaf blocks inside a list item (the <p> wrappers of loose lists) are
//     left without dir; the list item itself establishes the direction.
//   - Code and math are pinned to isolated LTR runs via CSS.
// ---------------------------------------------------------------------------

/** Pristine renderer: wrappers delegate and only add the dir attribute. */
const baseRenderer = new Renderer();

// Depth while rendering a list item body; leaf blocks inside inherit the
// item's direction instead of establishing their own. Depth handles nesting.
let listItemDepth = 0;

function isTagWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\f" || ch === "\r";
}

/** Whether an opening tag (passed without its closing ">") has a dir attribute. */
function hasDirAttribute(tag: string): boolean {
  let i = 0;
  while (i < tag.length && !isTagWhitespace(tag[i])) i += 1; // tag name
  while (i < tag.length) {
    while (i < tag.length && isTagWhitespace(tag[i])) i += 1;
    let name = "";
    while (
      i < tag.length &&
      !isTagWhitespace(tag[i]) &&
      tag[i] !== "=" &&
      tag[i] !== "/"
    ) {
      name += tag[i];
      i += 1;
    }
    if (name === "dir") return true;
    if (tag[i] === "=") {
      i += 1;
      const quote = tag[i];
      if (quote === '"' || quote === "'") {
        const end = tag.indexOf(quote, i + 1);
        i = end === -1 ? tag.length : end + 1;
      } else {
        while (i < tag.length && !isTagWhitespace(tag[i])) i += 1;
      }
    }
  }
  return false;
}

/** Add dir="auto" to a block's first opening tag, preserving an explicit dir. */
function withAutoDir(html: string): string {
  const close = html.indexOf(">");
  if (close === -1) return html;
  const tag = html.slice(0, close);
  if (hasDirAttribute(tag)) return html;
  return `${tag} dir="auto"${html.slice(close)}`;
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
marked.use({
  renderer: {
    paragraph(token) {
      const html = baseRenderer.paragraph.call(this, token);
      return listItemDepth > 0 ? html : withAutoDir(html);
    },
    heading(token) {
      const html = baseRenderer.heading.call(this, token);
      return listItemDepth > 0 ? html : withAutoDir(html);
    },
    listitem(token) {
      listItemDepth += 1;
      try {
        return withAutoDir(baseRenderer.listitem.call(this, token));
      } finally {
        listItemDepth -= 1;
      }
    },
    table(token) {
      return withAutoDir(baseRenderer.table.call(this, token));
    },
  },
});
marked.use({ hooks });

/**
 * Render Markdown to sanitized HTML plus plain code-block data.
 * Synchronous: no highlighting here, so there is no async work to await.
 */
export function renderMarkdown(source: string): RenderedMarkdown {
  const codeBlocks: CodeBlockData[] = [];
  renderContext = { codeBlocks };
  try {
    // marked is configured with synchronous extensions only; the cast reflects
    // that `parse` cannot return a Promise in this configuration.
    const raw = marked.parse(source) as string;

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

const cache = new Map<string, RenderedMarkdown>();
const MAX_CACHE = 200;
export function cachedMarkdown(source: string): RenderedMarkdown {
  const hit = cache.get(source);
  if (hit) return hit;
  const result = renderMarkdown(source);
  cache.set(source, result);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}
