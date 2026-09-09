<script setup lang="ts">
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { MessageSquareText, Image } from "@lucide/vue";
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyTitle>404 - Not Found</EmptyTitle>
      <EmptyDescription>
        The page you're looking for doesn't exist.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <div class="flex gap-2">
        <RouterLink to="/chat">
          <Button size="sm">
            <MessageSquareText />
            Chat
          </Button>
        </RouterLink>
        <RouterLink to="/draw">
          <Button size="sm">
            <Image />
            Draw
          </Button>
        </RouterLink>
      </div>
    </EmptyContent>
  </Empty>
</template>
