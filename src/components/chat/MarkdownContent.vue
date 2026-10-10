<script setup lang="ts">
import {
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  watch,
  type VNodeChild,
} from "vue";
import { storeToRefs } from "pinia";
import { cachedMarkdown, type RenderedMarkdown } from "@/lib/markdown";
import { usePreferencesStore } from "@/stores/preferences";
import CodeBlock from "./CodeBlock.vue";

const props = defineProps<{ source: string }>();
const { isDark } = storeToRefs(usePreferencesStore());

const result = ref<RenderedMarkdown>({ html: "", codeBlocks: [] });
let renderId = 0;

watch(
  [() => props.source, isDark],
  async () => {
    const currentRenderId = ++renderId;

    if (!props.source) {
      result.value = { html: "", codeBlocks: [] };
      return;
    }

    const rendered = await cachedMarkdown(props.source, isDark.value);
    if (currentRenderId !== renderId) return;

    result.value = rendered;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  renderId++;
});

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
          highlightedHtml: data.highlightedHtml,
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
