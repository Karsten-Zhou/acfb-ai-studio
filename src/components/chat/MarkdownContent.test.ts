// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { i18n } from "@/lib/i18n";
import MarkdownContent from "./MarkdownContent.vue";

// jsdom lacks window.matchMedia, which the preferences store's usePreferredDark() needs.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

const SOURCE = [
  "```python",
  "print('hi')",
  "```",
  "",
  "```ts",
  "const x = 1",
  "```",
].join("\n");

async function mountMarkdown(source: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({ render: () => h(MarkdownContent, { source }) });
  app.use(createPinia());
  app.use(i18n);
  app.mount(host);
  // The pipeline is async (shiki init); poll until blocks mount or timeout.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (host.querySelectorAll("button").length > 0) break;
  }
  return { host, app };
}

describe("MarkdownContent", () => {
  it("replaces code-block markers with mounted CodeBlock components", async () => {
    const { host, app } = await mountMarkdown(SOURCE);
    // The inert markers must be gone, replaced by real components.
    expect(host.querySelectorAll("code-block[data-block]")).toHaveLength(0);
    // One copy button per fenced block.
    expect(host.querySelectorAll("button")).toHaveLength(2);
    // Language labels and code are rendered by Vue, not injected HTML.
    expect(host.textContent).toContain("python");
    expect(host.textContent).toContain("print('hi')");
    expect(host.textContent).toContain("ts");
    expect(host.textContent).toContain("const x = 1");
    app.unmount();
  });

  it("renders nothing when the source is empty", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp({
      render: () => h(MarkdownContent, { source: "" }),
    });
    app.use(createPinia());
    app.use(i18n);
    app.mount(host);
    // The empty-source branch is synchronous; one tick is enough to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.textContent).toBe("");
    app.unmount();
  });
});
