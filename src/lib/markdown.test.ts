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
    expect(html).toContain("<h1>Heading ");
    expect(html).toContain('class="katex"');
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
});
