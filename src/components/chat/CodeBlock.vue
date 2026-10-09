<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Check, Copy } from "@lucide/vue";
import { Button } from "@/components/ui/button";

const props = defineProps<{
  code: string;
  language: string;
  /** Shiki-generated HTML, already sanitized at the markdown boundary. */
  highlightedHtml?: string;
}>();

const { t } = useI18n();

const copied = ref(false);

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code);
  } catch {
    // Fallback for non-HTTPS contexts / older browsers.
    const ta = document.createElement("textarea");
    ta.value = props.code;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      // Clipboard unavailable even via fallback.
    }
    ta.remove();
  }
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="my-3 overflow-hidden rounded-lg border">
    <div
      class="flex items-center justify-between border-b bg-muted/50 py-1.5 pl-3 pr-1.5"
    >
      <span class="font-mono text-xs text-muted-foreground">
        {{ language }}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="copied ? t('common.copied') : t('chat.copyCode')"
        :title="copied ? t('common.copied') : t('chat.copyCode')"
        @click="copy"
      >
        <Check v-if="copied" />
        <Copy v-else />
      </Button>
    </div>
    <!-- eslint-disable vue/no-v-html -- highlightedHtml is sanitized in lib/markdown -->
    <div v-if="highlightedHtml" v-html="highlightedHtml" />
    <!-- eslint-enable vue/no-v-html -->
    <pre
      v-else
      class="m-0 w-full overflow-x-auto p-4 text-sm"
    ><code>{{ code }}</code></pre>
  </div>
</template>

<style scoped>
/* Reset the global pre.shiki frame so the wrapper owns border/radius. */
:deep(pre.shiki) {
  margin: 0;
  width: 100%;
  border: 0;
  border-radius: 0;
}
</style>
