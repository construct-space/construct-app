<script setup lang="ts" vapor>
import type { ProgressBlock } from '@/assistant'

defineProps<{
  block: ProgressBlock
}>()
</script>

<template>
  <div class="my-1 rounded-lg border border-app-border bg-white/[0.03] px-3 py-2">
    <div class="flex items-center gap-2">
      <span class="size-1.5 rounded-full bg-[#00ff41] animate-pulse" />
      <span class="text-xs font-medium text-app">{{ block.headline }}</span>
      <span v-if="block.phase" class="text-[10px] text-app-muted">{{ block.phase }}</span>
    </div>
    <p v-if="block.detail" class="mt-1 text-xs text-app-muted">{{ block.detail }}</p>
    <div v-if="block.percent != null" class="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
      <div class="h-full bg-app-accent rounded-full transition-all" :style="{ width: `${block.percent}%` }" />
    </div>
  </div>
</template>
