<script setup lang="ts">
import { computed } from "vue";
import {
  AlertCircle,
  Check,
  CloudOff,
  HardDrive,
  RefreshCw,
} from "@lucide/vue";
import { useNow } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { requestSync, resetSyncState } from "@/composables/sync";
import { useSyncStore } from "@/stores/sync";
import { formatRelativeTime } from "@/lib/i18n";

const { t } = useI18n({ useScope: "global" });
const sync = useSyncStore();

/** Ticks so "synced 2m ago" stays truthful without re-rendering constantly. */
const now = useNow({ interval: 15_000 });

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

const status = computed(() => {
  if (sync.error) {
    return {
      icon: AlertCircle,
      label: sync.error.message,
      tone: "text-destructive",
      spin: false,
    };
  }
  if (sync.phase === "syncing") {
    return {
      icon: RefreshCw,
      label: t("sync.syncing"),
      tone: "text-muted-foreground",
      spin: true,
    };
  }
  if (sync.localMeta.dirty) {
    return {
      icon: CloudOff,
      label: t("sync.pending"),
      tone: "text-muted-foreground",
      spin: false,
    };
  }
  return {
    icon: Check,
    label: t("sync.synced", {
      time: formatRelativeTime(
        sync.lastSyncedAt ?? sync.localMeta.lastSyncedAt,
        now.value.getTime(),
      ),
    }),
    tone: "text-muted-foreground",
    spin: false,
  };
});

/** The single KV entry fills up predictably, so show how much room is left. */
const percent = computed(() =>
  Math.min(100, Math.round(sync.storageUsage.ratio * 100)),
);

const barTone = computed(() => {
  if (sync.storageUsage.blocked) return "bg-destructive";
  if (percent.value > 50) return "bg-amber-500";
  return "bg-primary";
});

async function onReset() {
  if (!window.confirm(t("sync.resetConfirm"))) return;
  await resetSyncState();
}
</script>

<template>
  <div class="flex flex-col gap-2 px-2 py-1">
    <div class="flex items-center gap-2">
      <component
        :is="status.icon"
        :class="[
          'size-3.5 shrink-0',
          status.tone,
          status.spin ? 'animate-spin' : '',
        ]"
      />
      <span
        :class="['min-w-0 flex-1 truncate text-xs', status.tone]"
        :title="status.label"
      >
        {{ status.label }}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        class="h-6 w-6"
        :aria-label="t('sync.syncNow')"
        :disabled="sync.phase === 'syncing'"
        @click="requestSync"
      >
        <RefreshCw class="size-3.5" />
      </Button>
    </div>

    <div class="flex items-center gap-2">
      <HardDrive class="size-3.5 shrink-0 text-muted-foreground" />
      <div
        class="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        :title="
          t('sync.usage', {
            used: megabytes(sync.storageUsage.bytes),
            total: megabytes(sync.storageUsage.max),
          })
        "
      >
        <div
          class="h-full rounded-full transition-all"
          :class="barTone"
          :style="{ width: `${percent}%` }"
        />
      </div>
      <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {{ megabytes(sync.storageUsage.bytes) }}/{{
          megabytes(sync.storageUsage.max)
        }}
        MB
      </span>
    </div>

    <Button
      v-if="sync.error?.corrupt"
      size="sm"
      variant="outline"
      class="h-7 w-full text-xs"
      @click="onReset"
    >
      {{ t("sync.reset") }}
    </Button>
  </div>
</template>
