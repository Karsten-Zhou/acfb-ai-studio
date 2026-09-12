<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { MessageSquareText, Image } from "@lucide/vue";

const { t } = useI18n({ useScope: "global" });
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyTitle>{{ t("notFound.title") }}</EmptyTitle>
      <EmptyDescription>
        {{ t("notFound.description") }}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <div class="flex gap-2">
        <RouterLink to="/chat">
          <Button size="sm">
            <MessageSquareText />
            {{ t("nav.chat") }}
          </Button>
        </RouterLink>
        <RouterLink to="/draw">
          <Button size="sm">
            <Image />
            {{ t("nav.draw") }}
          </Button>
        </RouterLink>
      </div>
    </EmptyContent>
  </Empty>
</template>
