<script setup lang="ts">
/**
 * ArchitectStreamingMessage - Shows AI response being streamed
 */
defineProps<{
  content: string
  status: string
}>()
</script>

<template>
  <div class="flex gap-3">
    <div class="shrink-0 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
      <Icon name="i-lucide-loader-2" class="size-3 text-white animate-spin" />
    </div>
    <div class="flex-1">
      <!-- Status badge -->
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-medium">
          {{ status }}
        </span>
      </div>
      <!-- Streaming content -->
      <div v-if="content" class="text-sm">
        <MarkdownContent
          :content="content"
          streaming
          class="prose prose-sm dark:prose-invert max-w-none"
        />
        <span class="inline-block w-1.5 h-3.5 bg-blue-500 animate-pulse mt-1" />
      </div>
    </div>
  </div>
</template>
