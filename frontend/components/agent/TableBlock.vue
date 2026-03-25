<script setup lang="ts">
import type { TableBlock } from '@/operator/useAgentSession'

defineProps<{
  block: TableBlock
}>()
</script>

<template>
  <div class="my-2 overflow-x-auto rounded-lg border border-app-border">
    <table class="w-full text-xs">
      <thead>
        <tr class="bg-white/5">
          <th v-for="h in block.headers" :key="h" class="px-3 py-1.5 text-left text-app-muted font-medium">{{ h }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, ri) in block.rows" :key="ri" class="border-t border-app-border">
          <td v-for="(cell, ci) in row" :key="ci" class="px-3 py-1.5 text-app">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="block.caption" class="px-3 py-1 text-[10px] text-app-muted">{{ block.caption }}</p>
  </div>
</template>
