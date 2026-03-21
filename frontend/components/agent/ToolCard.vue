<script setup lang="ts">
/**
 * ToolCard — Collapsible tool call visualization
 *
 * Shows: tool name + title in header, input + result in collapsible body.
 * State indicator: spinner (running), check (done), x (error).
 */
import { ref } from 'vue'
import type { ToolBlock } from '@/operator/useAgentSession'

defineProps<{
  block: ToolBlock
}>()

const expanded = ref(false)
</script>

<template>
  <div
    class="rounded-lg border overflow-hidden text-xs my-1.5"
    :class="block.state === 'error' ? 'border-red-500/30' : 'border-app-border'"
  >
    <!-- Header -->
    <button
      class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
      @click="expanded = !expanded"
    >
      <!-- State indicator -->
      <span v-if="block.state === 'running'" class="size-3.5 shrink-0">
        <span class="block size-3.5 rounded-full border-2 border-app-accent border-t-transparent animate-spin" />
      </span>
      <span v-else-if="block.state === 'done'" class="size-3.5 text-emerald-500 shrink-0">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
      </span>
      <span v-else class="size-3.5 text-red-500 shrink-0">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>
      </span>

      <!-- Tool name -->
      <span class="font-mono text-app-muted">{{ block.tool }}</span>

      <!-- Title -->
      <span class="flex-1 truncate text-app-foreground/70">{{ block.title }}</span>

      <!-- Chevron -->
      <svg
        class="size-3 text-app-muted transition-transform shrink-0"
        :class="expanded ? 'rotate-180' : ''"
        viewBox="0 0 16 16" fill="currentColor"
      >
        <path d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"/>
      </svg>
    </button>

    <!-- Body -->
    <div v-if="expanded" class="border-t border-app-border">
      <div v-if="block.input" class="px-3 py-2 bg-black/10 dark:bg-white/3">
        <div class="text-[10px] text-app-muted uppercase tracking-wider mb-1">Input</div>
        <pre class="text-app-foreground/80 whitespace-pre-wrap break-all font-mono text-[11px] max-h-32 overflow-auto">{{ block.input }}</pre>
      </div>
      <div v-if="block.result" class="px-3 py-2">
        <div class="text-[10px] text-app-muted uppercase tracking-wider mb-1">Result</div>
        <pre class="text-app-foreground/80 whitespace-pre-wrap break-all font-mono text-[11px] max-h-48 overflow-auto">{{ block.result }}</pre>
      </div>
    </div>
  </div>
</template>
