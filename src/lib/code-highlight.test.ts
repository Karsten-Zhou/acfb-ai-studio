// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  firstLangTag,
  getHighlighter,
  highlightCode,
  loadLanguages,
  resolveTheme,
} from "./code-highlight";

describe("firstLangTag", () => {
  it("takes the first whitespace-delimited token, lowercased", () => {
    expect(firstLangTag("ts title=x")).toBe("ts");
    expect(firstLangTag("TS")).toBe("ts");
    expect(firstLangTag("  python\nmore")).toBe("");
    expect(firstLangTag("")).toBe("");
  });
});

describe("resolveTheme", () => {
  it("maps light/dark flags to Shiki theme names", () => {
    expect(resolveTheme(true)).toBe("2026 Dark");
    expect(resolveTheme(false)).toBe("2026 Light");
  });
});

describe("highlightCode", () => {
  it("highlights a known language to sanitized <pre>/<code> HTML", async () => {
    const highlighter = await getHighlighter();
    const html = highlightCode(
      highlighter,
      "const a = 1;",
      "ts",
      resolveTheme(true),
    );
    expect(html).toContain("<code");
    expect(html).toContain("const");
  });

  it("loads new languages on demand and then highlights them", async () => {
    await loadLanguages(["rust"]);
    const highlighter = await getHighlighter();
    const html = highlightCode(
      highlighter,
      "fn main() {}",
      "rust",
      resolveTheme(false),
    );
    expect(html).toContain("main");
  });

  it("falls back to plain text for unknown languages without throwing", async () => {
    const highlighter = await getHighlighter();
    const html = highlightCode(
      highlighter,
      "<b>not html</b>",
      "nope",
      resolveTheme(true),
    );
    // Sanitizer escapes the text; it must not be injected as markup.
    expect(html).not.toContain("<b>not html</b>");
    expect(html).toContain("not html");
  });
});
