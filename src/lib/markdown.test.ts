// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("emits an inert marker per fenced code block and collects structured data", async () => {
    const md = [
      "Text before",
      "",
      "```ts",
      "const a: number = 1;",
      "```",
      "",
      "```python",
      "print('hi')",
      "```",
    ].join("\n");
    const { html, codeBlocks } = await renderMarkdown(md);
    expect(html).toContain('<code-block data-block="0"></code-block>');
    expect(html).toContain('<code-block data-block="1"></code-block>');
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0]).toMatchObject({
      language: "ts",
      code: "const a: number = 1;",
    });
    expect(codeBlocks[0].highlightedHtml).toContain("<code>");
    expect(codeBlocks[0].highlightedHtml).toContain("const");
    expect(codeBlocks[1]).toMatchObject({
      language: "python",
      code: "print('hi')",
    });
  });

  it("converts \\(...\\) and \\[...\\] math via the token AST", async () => {
    const md = String.raw`Inline \(a+b\) and display \[c^2\] here.`;
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="katex"');
    expect(html).not.toContain(String.raw`\(a+b\)`);
  });

  it("converts math in headings too", async () => {
    const { html } = await renderMarkdown(String.raw`# Heading \[h^2\]`);
    expect(html).toContain('<h1 dir="auto">Heading ');
    expect(html).toContain('class="katex"');
  });

  it("stamps dir=auto on leaf blocks while containers inherit", async () => {
    const md = [
      "# عنوان",
      "",
      "فقرة عربية.",
      "",
      "English paragraph.",
      "",
      "> اقتباس",
    ].join("\n");
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<h1 dir="auto">');
    // Blockquotes carry no dir — they follow the shell; their inner
    // paragraphs still resolve independently.
    expect(html).not.toContain("<blockquote dir");
    const paragraphs = html.match(/<p[^>]*>/g) ?? [];
    expect(paragraphs.every((p) => p.includes('dir="auto"'))).toBe(true);
  });

  it("stamps dir=auto on list items and tables, not lists or code markers", async () => {
    const md = [
      "- عربي",
      "- English",
      "",
      "| أ | ب |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");
    const { html } = await renderMarkdown(md);
    // The list itself inherits; each item resolves its own direction.
    expect(html).not.toContain("<ul dir");
    const items = html.match(/<li[^>]*>/g) ?? [];
    expect(items).toHaveLength(2);
    expect(items.every((li) => li.includes('dir="auto"'))).toBe(true);
    expect(html).toContain('<table dir="auto">');
    // The code marker carries no direction; its CodeBlock UI is pinned LTR.
    expect(html).toContain("<code-block ");
    expect(html).not.toContain("<code-block dir=");
  });

  it("does not stamp dir on loose-list paragraph wrappers", async () => {
    // Blank lines make a loose list: marked wraps item text in <p>. The item
    // carries dir="auto"; the inner <p> must not isolate itself away.
    const md = "- عربي\n\n- English";
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<li dir="auto">');
    expect(html).toContain("<p>");
    expect(html).not.toContain("<p dir=");
  });

  it("leaves code spans and fenced code containing delimiters untouched", async () => {
    const md = [
      "`\\(not math\\)` stays a code span",
      "",
      "```",
      String.raw`\(still code\)`,
      "```",
    ].join("\n");
    const { html, codeBlocks } = await renderMarkdown(md);
    expect(html).toContain("<code>");
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0].code).toBe(String.raw`\(still code\)`);
  });

  it("keeps unbalanced delimiters literal", async () => {
    const { html } = await renderMarkdown(String.raw`Unbalanced \(oops`);
    expect(html).toContain("(oops");
  });

  it("renders latex/math/tex fences as KaTeX, not code blocks", async () => {
    const md = "```latex\nx = y\n```";
    const { html, codeBlocks } = await renderMarkdown(md);
    expect(codeBlocks).toHaveLength(0);
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("code-block");
  });

  it("keeps $...$ math from the marked-katex extension", async () => {
    const { html } = await renderMarkdown("Inline $x^2$ math");
    expect(html).toContain('class="katex"');
  });

  it("lets the browser resolve an item that starts with isolated inline code", async () => {
    // The code span is LTR but bidi-isolated by CSS; the item carries
    // dir="auto" and the browser resolves from the Arabic after it.
    const { html } = await renderMarkdown("- `const x = 1` عنصر عربي");
    expect(html).toContain('<li dir="auto">');
    expect(html).toContain("<code>");
  });
});
