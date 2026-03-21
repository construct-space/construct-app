<script setup lang="ts">
/**
 * ResponseBlocks — Renders an array of ResponseBlock[]
 *
 * Each block type gets its own visual treatment:
 * - text: whitespace-pre-wrap prose
 * - tool: ToolCard (collapsible)
 * - code: pre+code with language label
 * - svg: inline render
 * - image: img tag
 * - error: red card
 * - status: subtle indicator
 */
import type { ResponseBlock } from '@/operator/useAgentSession'
import ToolCard from './ToolCard.vue'

defineProps<{
  blocks: ResponseBlock[]
}>()
</script>

<template>
  <div class="space-y-0">
    <template v-for="(block, i) in blocks" :key="i">
      <!-- Text -->
      <div v-if="block.type === 'text'" class="text-sm leading-relaxed whitespace-pre-wrap py-0.5">
        {{ block.content }}
      </div>

      <!-- Tool -->
      <ToolCard v-else-if="block.type === 'tool'" :block="block" />

      <!-- Code -->
      <div v-else-if="block.type === 'code'" class="my-1.5 rounded-lg overflow-hidden border border-app-border">
        <div class="flex items-center px-3 py-1 bg-black/10 dark:bg-white/5 text-[10px] text-app-muted">
          {{ block.language }}
        </div>
        <pre class="px-3 py-2 text-xs font-mono overflow-x-auto"><code>{{ block.content }}</code></pre>
      </div>

      <!-- SVG -->
      <div v-else-if="block.type === 'svg'" class="my-1.5 flex justify-center p-4 rounded-lg border border-app-border bg-white dark:bg-white/5" v-html="block.content" />

      <!-- Image -->
      <div v-else-if="block.type === 'image'" class="my-1.5">
        <img :src="block.src" :alt="block.alt || ''" class="max-w-full rounded-lg border border-app-border" />
      </div>

      <!-- Error -->
      <div v-else-if="block.type === 'error'" class="my-1.5 px-3 py-2 text-xs text-red-500 bg-red-500/10 rounded-lg border border-red-500/20">
        {{ block.message }}
      </div>

      <!-- Status -->
      <div v-else-if="block.type === 'status'" class="flex items-center gap-2 py-1 text-xs text-app-muted">
        <span class="size-1.5 rounded-full bg-app-accent animate-pulse" />
        {{ block.message }}
      </div>
    </template>
  </div>
</template>
