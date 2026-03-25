<script setup lang="ts">
import type { CodeBlock } from '@/operator/useAgentSession'

defineProps<{
  block: CodeBlock
}>()
</script>

<template>
  <div class="my-1.5 rounded-lg overflow-hidden border border-app-border">
    <div class="flex items-center justify-between px-3 py-1 bg-black/10 dark:bg-white/5 text-[10px] text-app-muted">
      <span>{{ block.language }}</span>
      <span v-if="block.filename" class="font-mono">{{ block.filename }}</span>
    </div>
    <pre class="px-3 py-2 text-xs font-mono overflow-x-auto"><code>{{ block.content }}</code></pre>
  </div>
</template>
