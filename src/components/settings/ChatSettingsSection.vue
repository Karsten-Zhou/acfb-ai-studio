<script setup lang="ts">
// Chat defaults: automatic conversation title generation and the global system
// prompt sent with every chat request. Both persist through `defaultOptions`
// (localStorage + cross-device sync), so they survive reloads and routes.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Bot } from "@lucide/vue";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { defaultOptions } from "@/composables/chat-defaults";

const { t } = useI18n();

/**
 * Writable computeds bridge the optional persisted fields (`autoTitle?`,
 * `systemPrompt?`) and the boolean/string controls: old persisted blobs that
 * lack a key keep the documented default instead of rendering an empty switch.
 *
 * NOTE: the Switch is bound through reka-ui's current API (`modelValue` /
 * `update:modelValue`), not the legacy `checked` / `update:checked` contract.
 */
const autoTitle = computed<boolean>({
  get: () => defaultOptions.autoTitle ?? true,
  set: (value) => {
    defaultOptions.autoTitle = value;
  },
});

const systemPrompt = computed<string>({
  get: () => defaultOptions.systemPrompt ?? "",
  set: (value) => {
    defaultOptions.systemPrompt = value;
  },
});
</script>

<template>
  <section class="space-y-4">
    <h2 class="flex items-center gap-1.5 text-sm font-semibold">
      <Bot class="size-4" />
      {{ t("settings.chat") }}
    </h2>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex-1 space-y-0.5">
          <Label for="settings-auto-title" class="text-muted-foreground">
            {{ t("settings.autoTitle") }}
          </Label>
          <p class="text-xs text-muted-foreground">
            {{ t("settings.autoTitleDescription") }}
          </p>
        </div>
        <Switch
          id="settings-auto-title"
          class="shrink-0"
          :model-value="autoTitle"
          @update:model-value="(value) => (autoTitle = value === true)"
        />
      </div>
    </div>

    <div class="space-y-2">
      <Label
        for="settings-system-prompt"
        class="flex items-center gap-1.5 text-muted-foreground"
      >
        {{ t("settings.systemPrompt") }}
      </Label>
      <Textarea
        id="settings-system-prompt"
        v-model="systemPrompt"
        :rows="4"
        :placeholder="t('settings.systemPromptPlaceholder')"
      />
      <p class="text-xs text-muted-foreground">
        {{ t("settings.systemPromptDescription") }}
      </p>
    </div>
  </section>
</template>
