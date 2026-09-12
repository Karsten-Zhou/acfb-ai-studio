<script setup lang="ts">
// Version, build time and source link. The three values are injected at build
// time by Vite (`define` in vite.config.ts), so they cannot drift from the
// deployed artifact.
import { useI18n } from "vue-i18n";
import { ExternalLink, Info } from "@lucide/vue";
import { formatDateTime } from "@/lib/i18n";

const { t } = useI18n({ useScope: "global" });

const version = __APP_VERSION__;
const buildTime = __APP_BUILD_TIME__;
const repoUrl = __APP_REPO_URL__;
</script>

<template>
  <section class="space-y-3">
    <h2 class="flex items-center gap-1.5 text-sm font-semibold">
      <Info class="size-4" />
      {{ t("common.about") }}
    </h2>

    <dl class="space-y-1.5 text-sm">
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">{{ t("common.version") }}</dt>
        <dd class="font-medium">{{ version }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">{{ t("common.buildTime") }}</dt>
        <dd class="font-medium">{{ formatDateTime(buildTime) }}</dd>
      </div>
    </dl>

    <a
      :href="repoUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
    >
      <ExternalLink class="size-4" />
      {{ t("common.viewSource") }}
    </a>
  </section>
</template>
