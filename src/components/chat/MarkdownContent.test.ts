// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createApp, h, ref } from "vue";
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

async function waitFor(host: HTMLElement, predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for Markdown render. Current text: ${host.textContent}`,
  );
}

async function mountMarkdown(source: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({ render: () => h(MarkdownContent, { source }) });
  app.use(createPinia());
  app.use(i18n);
  app.mount(host);
  await waitFor(host, () => host.querySelectorAll("button").length === 2);
  return { host, app };
}

describe("MarkdownContent", () => {
  it("renders code blocks as Vue components", async () => {
    const { host, app } = await mountMarkdown(SOURCE);

    expect(host.querySelectorAll("code-block[data-block]")).toHaveLength(0);
    expect(host.querySelectorAll("button")).toHaveLength(2);
    expect(host.textContent).toContain("python");
    expect(host.textContent).toContain("print('hi')");
    expect(host.textContent).toContain("ts");
    expect(host.textContent).toContain("const x = 1");

    app.unmount();
    host.remove();
  });

  it("preserves an existing code block while a later block streams", async () => {
    const source = ref(SOURCE);
    const host = document.createElement("div");
    document.body.appendChild(host);

    const app = createApp({
      render: () => h(MarkdownContent, { source: source.value }),
    });
    app.use(createPinia());
    app.use(i18n);
    app.mount(host);

    await waitFor(host, () => host.querySelectorAll("button").length === 2);

    const originalButtons = Array.from(host.querySelectorAll("button"));
    const updatedSource = [
      "```python",
      "print('hi')",
      "```",
      "",
      "```ts",
      "const x = 1",
      "const y = 2",
    ].join("\n");

    source.value = updatedSource;

    await waitFor(
      host,
      () =>
        host.textContent?.includes("const y = 2") === true &&
        host.querySelectorAll("button").length === 2,
    );

    const updatedButtons = Array.from(host.querySelectorAll("button"));

    expect(updatedButtons[0]).toBe(originalButtons[0]);
    expect(updatedButtons[1]).toBe(originalButtons[1]);
    expect(host.textContent).toContain("print('hi')");
    expect(host.textContent).toContain("const y = 2");

    app.unmount();
    host.remove();
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

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.textContent).toBe("");

    app.unmount();
    host.remove();
  });
});
