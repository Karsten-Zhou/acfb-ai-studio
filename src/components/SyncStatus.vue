<script setup lang="ts">
import { computed } from "vue";
import { AlertCircle, Check, CloudOff, HardDrive, RefreshCw } from "@lucide/vue";
import { useNow } from "@vueuse/core";
import { Button } from "@/components/ui/button";
import { requestSync, resetSyncState } from "@/composables/sync";
import { localMeta, storageUsage, syncState } from "@/composables/sync-state";

/** Ticks so "synced 2m ago" stays truthful without re-rendering constantly. */
const now = useNow({ interval: 15_000 });

function relative(ts: number | null): string {
  if (!ts) return "not yet";
  const seconds = Math.max(0, Math.round((now.value.getTime() - ts) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

const status = computed(() => {
  if (syncState.error) {
    return {
      icon: AlertCircle,
      label: syncState.error.message,
      tone: "text-destructive",
      spin: false,
    };
  }
  if (syncState.phase === "syncing") {
    return {
      icon: RefreshCw,
      label: "Syncing…",
      tone: "text-muted-foreground",
      spin: true,
    };
  }
  if (localMeta.value.dirty) {
    return {
      icon: CloudOff,
      label: "Saved locally, waiting to sync…",
      tone: "text-muted-foreground",
      spin: false,
    };
  }
  return {
    icon: Check,
    label: `Synced ${relative(syncState.lastSyncedAt ?? localMeta.value.lastSyncedAt)}`,
    tone: "text-muted-foreground",
    spin: false,
  };
});

/** The single KV entry fills up predictably, so show how much room is left. */
const percent = computed(() =>
  Math.min(100, Math.round(storageUsage.value.ratio * 100)),
);

const barTone = computed(() => {
  if (storageUsage.value.blocked) return "bg-destructive";
  if (percent.value > 50) return "bg-amber-500";
  return "bg-primary";
});

async function onReset() {
  const ok = window.confirm(
    "Replace the synced copy on the server with this device's history? Other devices will pick up this device's state on their next sync.",
  );
  if (!ok) return;
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
        aria-label="Sync now"
        :disabled="syncState.phase === 'syncing'"
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
        :title="`${megabytes(storageUsage.bytes)} MB of ${megabytes(storageUsage.max)} MB used`"
      >
        <div
          class="h-full rounded-full transition-all"
          :class="barTone"
          :style="{ width: `${percent}%` }"
        />
      </div>
      <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {{ megabytes(storageUsage.bytes) }}/{{ megabytes(storageUsage.max) }} MB
      </span>
    </div>

    <Button
      v-if="syncState.error?.corrupt"
      size="sm"
      variant="outline"
      class="h-7 w-full text-xs"
      @click="onReset"
    >
      Reset synced copy
    </Button>
  </div>
</template>
