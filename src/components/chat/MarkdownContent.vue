<script setup lang="ts">
import { defineComponent, h, ref, watch, type VNodeChild } from "vue";
import { cachedMarkdown, type RenderedMarkdown } from "@/lib/markdown";
import CodeBlock from "./CodeBlock.vue";

const props = defineProps<{ source: string }>();

const result = ref<RenderedMarkdown>({ html: "", codeBlocks: [] });

// Rendering is synchronous and no longer depends on the theme: <CodeBlock/>
// owns highlighting and reacts to theme changes on its own.
watch(
  () => props.source,
  (source) => {
    result.value = source
      ? cachedMarkdown(source)
      : { html: "", codeBlocks: [] };
  },
  { immediate: true },
);

/**
 * Convert sanitized Markdown HTML into Vue VNodes. Code-block markers become
 * keyed Vue components, so Vue reconciles them instead of replacing the entire
 * message DOM with v-html.
 */
const contentRenderer = defineComponent({
  name: "MarkdownContentRenderer",
  setup() {
    function toVNode(node: Node): VNodeChild {
      if (node.nodeType === 3) return node.textContent ?? "";
      if (node.nodeType !== 1) return null;

      const element = node as Element;
      const tag = element.localName;

      if (tag === "code-block") {
        const rawIndex = element.getAttribute("data-block");
        const index = rawIndex === null ? Number.NaN : Number(rawIndex);
        const data = result.value.codeBlocks[index];
        if (!data) return null;

        return h(CodeBlock, {
          key: `code-block-${index}`,
          code: data.code,
          language: data.language,
        });
      }

      const vnodeProps: Record<string, string> = {};
      for (const attribute of Array.from(element.attributes)) {
        vnodeProps[attribute.name] = attribute.value;
      }

      const children = Array.from(element.childNodes)
        .map(toVNode)
        .filter((child) => child !== null);

      return h(tag, vnodeProps, children.length ? children : undefined);
    }

    return () => {
      // renderMarkdown sanitizes this HTML before it reaches the renderer.
      const template = document.createElement("template");
      template.innerHTML = result.value.html;

      const children = Array.from(template.content.childNodes)
        .map(toVNode)
        .filter((child) => child !== null);

      return h("div", children);
    };
  },
});
</script>

<template>
  <component :is="contentRenderer" />
</template>
