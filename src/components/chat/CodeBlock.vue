<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { Check, Copy } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/stores/preferences";
import {
  getHighlighter,
  highlightCode,
  highlightCodeSync,
  loadLanguages,
  resolveTheme,
} from "@/lib/code-highlight";
import { toastError } from "@/lib/toast";

const props = defineProps<{
  code: string;
  language: string;
}>();

const { t } = useI18n();
const { isDark } = storeToRefs(usePreferencesStore());

// Highlighting is owned here: theme-aware, and only the block whose `code`
// changed re-highlights (Vue reuses keyed instances while a message streams).
const html = ref("");

watch(
  () => [props.code, props.language, isDark.value] as const,
  async ([code, language, dark], _, onCleanup) => {
    if (!code) {
      html.value = "";
      return;
    }
    const lang = language || "text";
    const theme = resolveTheme(dark);

    // Fast path: warm highlighter + loaded language → highlight synchronously,
    // so a streaming message updates without waiting on the async path.
    const sync = highlightCodeSync(code, lang, theme);
    if (sync !== null) {
      html.value = sync;
      return;
    }

    // Cold path: drop stale HTML, then load the language and highlight.
    html.value = "";
    let cancelled = false;
    onCleanup(() => (cancelled = true));

    await loadLanguages([lang]);
    const highlighter = await getHighlighter();
    if (cancelled) return;
    html.value = highlightCode(highlighter, code, lang, theme);
  },
  { immediate: true },
);

const copied = ref(false);

/**
 * Legacy copy path for insecure contexts and older browsers. `execCommand`
 * reports success in its return value, so a false there is a real failure.
 */
function copyViaTextArea(code: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = code;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    console.error("[clipboard] execCommand copy failed:", error);
  }
  ta.remove();
  return ok;
}

async function copy() {
  let succeeded: boolean;
  try {
    await navigator.clipboard.writeText(props.code);
    succeeded = true;
  } catch (error) {
    // The Clipboard API needs a secure context; fall back to `execCommand`.
    console.warn(
      "[clipboard] async copy unavailable, trying execCommand:",
      error,
    );
    succeeded = copyViaTextArea(props.code);
  }

  // The "copied" tick must only appear when something actually landed on the
  // clipboard, otherwise the UI claims a copy the user cannot paste.
  if (!succeeded) {
    toastError(t("common.copyFailed"), t("common.copyFailedDescription"));
    return;
  }
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <!-- Code is always LTR, even inside an RTL UI. -->
  <div dir="ltr" class="my-3 overflow-hidden rounded-lg border">
    <div
      class="flex items-center justify-between border-b bg-muted/50 py-1.5 ps-3 pe-1.5"
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
    <!-- eslint-disable vue/no-v-html -- HTML is sanitized in lib/code-highlight -->
    <div v-html="html" />
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<style scoped>
:deep(pre.shiki) {
  margin: 0;
  border: 0;
}
</style>
