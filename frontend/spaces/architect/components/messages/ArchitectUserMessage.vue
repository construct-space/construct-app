<script setup lang="ts">
/**
 * ArchitectUserMessage - User message bubble
 */
defineProps<{
  content: string
}>()
</script>

<template>
  <div class="flex gap-3">
    <div class="shrink-0 w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
      <Icon name="i-lucide-user" class="size-3 text-app-muted" />
    </div>
    <p class="flex-1 text-sm text-app pt-0.5">{{ content }}</p>
  </div>
</template>
