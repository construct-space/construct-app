<script setup lang="ts">
import type { PlanBlock } from '@/assistant'
import { Compass } from 'lucide-vue-next'

defineProps<{
  block: PlanBlock
}>()
</script>

<template>
  <div class="my-2 rounded-xl border border-app-border bg-white/[0.03] p-4">
    <div class="flex items-center gap-2 mb-2">
      <Compass class="size-4 text-app-accent" />
      <p class="text-sm font-semibold text-app">{{ block.name }}</p>
      <span v-if="block.planType" class="rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] text-app-accent">{{ block.planType }}</span>
    </div>
    <p class="text-xs text-app-muted mb-3">{{ block.description }}</p>

    <div v-if="block.tasks?.length" class="space-y-1">
      <div v-for="task in block.tasks" :key="task.id" class="flex items-start gap-2 text-xs">
        <span class="shrink-0 rounded bg-app-accent/15 px-1.5 py-0.5 text-[10px] font-mono text-app-accent">{{ task.id }}</span>
        <div>
          <span class="text-app font-medium">{{ task.title }}</span>
          <span v-if="task.files?.length" class="text-app-muted ml-1">({{ task.files.join(', ') }})</span>
        </div>
      </div>
    </div>

    <div v-else-if="block.features?.length" class="space-y-1">
      <div v-for="feat in block.features" :key="feat.name" class="text-xs">
        <span class="text-app font-medium">{{ feat.name }}</span>
        <span class="text-app-muted ml-1">{{ feat.description }}</span>
      </div>
    </div>
  </div>
</template>
