<script setup lang="ts">
// Theme (light / dark / follow system) and language (auto / en / zh / de).
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Languages, Monitor, Moon, Palette, Sun } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePreferencesStore, type ThemeSetting } from "@/stores/preferences";
import {
  languageLabel,
  resolveBrowserLocale,
  supportedLocales,
  type LocaleSetting,
} from "@/lib/i18n";

const { t } = useI18n({ useScope: "global" });
const preferences = usePreferencesStore();

const themes = computed<
  { value: ThemeSetting; label: string; icon: typeof Monitor }[]
>(() => [
  { value: "auto", label: t("settings.themeAuto"), icon: Monitor },
  { value: "light", label: t("settings.themeLight"), icon: Sun },
  { value: "dark", label: t("settings.themeDark"), icon: Moon },
]);

/** "Automatic (English)" plus every supported language, named in the current UI language. */
const localeOptions = computed<{ value: LocaleSetting; label: string }[]>(() => [
  {
    value: "auto",
    label: t("settings.languageAuto", {
      language: languageLabel(resolveBrowserLocale()),
    }),
  },
  ...supportedLocales.map((locale) => ({
    value: locale as LocaleSetting,
    label: languageLabel(locale),
  })),
]);
</script>

<template>
  <section class="space-y-4">
    <h2 class="flex items-center gap-1.5 text-sm font-semibold">
      <Palette class="size-4" />
      {{ t("settings.preferences") }}
    </h2>

    <div class="space-y-2">
      <Label class="text-muted-foreground">{{ t("settings.theme") }}</Label>
      <div class="flex gap-1.5">
        <Button
          v-for="option in themes"
          :key="option.value"
          class="flex-1"
          size="sm"
          :variant="preferences.theme === option.value ? 'default' : 'outline'"
          @click="preferences.theme = option.value"
        >
          <component :is="option.icon" class="size-4" />
          {{ option.label }}
        </Button>
      </div>
    </div>

    <div class="space-y-2">
      <Label for="settings-language" class="flex items-center gap-1.5 text-muted-foreground">
        <Languages class="size-3.5" />
        {{ t("settings.language") }}
      </Label>
      <Select v-model="preferences.locale">
        <SelectTrigger id="settings-language" class="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in localeOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </section>
</template>
