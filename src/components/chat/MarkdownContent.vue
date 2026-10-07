<script setup lang="ts">
import {
  getCurrentInstance,
  h,
  nextTick,
  onBeforeUnmount,
  ref,
  render,
  watch,
} from "vue";
import { storeToRefs } from "pinia";
import { cachedMarkdown, type RenderedMarkdown } from "@/lib/markdown";
import { usePreferencesStore } from "@/stores/preferences";
import CodeBlock from "./CodeBlock.vue";

const props = defineProps<{ source: string }>();

const { isDark } = storeToRefs(usePreferencesStore());

const container = ref<HTMLElement | null>(null);
const result = ref<RenderedMarkdown>({ html: "", codeBlocks: [] });

// Detached hosts keeping mounted <CodeBlock/> vnodes alive; unmounted on re-render and teardown.
const hosts: HTMLElement[] = [];

// Programmatic render() has no app context, which breaks plugin-provided
// components; carry MarkdownContent's context over to the mounted <CodeBlock/>.
const appContext = getCurrentInstance()?.appContext;

watch(
  [() => props.source, isDark],
  async () => {
    unmountCodeBlocks();
    if (!props.source) {
      result.value = { html: "", codeBlocks: [] };
      return;
    }
    result.value = await cachedMarkdown(props.source, isDark.value);
    await nextTick();
    mountCodeBlocks();
  },
  { immediate: true },
);

function mountCodeBlocks() {
  const root = container.value;
  if (!root) return;
  root.querySelectorAll("code-block[data-block]").forEach((marker) => {
    const data =
      result.value.codeBlocks[Number(marker.getAttribute("data-block"))];
    if (!data) return;
    const host = document.createElement("div");
    const vnode = h(CodeBlock, {
      code: data.code,
      language: data.language,
      highlightedHtml: data.highlightedHtml,
    });
    if (appContext) vnode.appContext = appContext;
    render(vnode, host);
    marker.replaceWith(...Array.from(host.childNodes));
    hosts.push(host);
  });
}

function unmountCodeBlocks() {
  for (const host of hosts) render(null, host);
  hosts.length = 0;
}

onBeforeUnmount(unmountCodeBlocks);
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- Html is sanitized by DOMPurify in lib/markdown -->
  <div ref="container" v-html="result.html" />
  <!-- eslint-enable vue/no-v-html -->
</template>
