<script setup lang="ts">
import { computed, ref } from 'vue'
import { Loader2, Check, X, Square, ChevronUp, ChevronDown } from 'lucide-vue-next'
import type { ToolActivity } from '@/operator/useStreamStatus'
import { getToolDisplay } from '../utils/toolDisplay'

const props = defineProps<{
  call: ToolActivity
}>()

const emit = defineEmits<{
  stop: []
}>()

const expanded = ref(false)
const display = computed(() => getToolDisplay(props.call))
</script>

<template>
  <div class="py-0.5 font-mono text-xs leading-5">
    <div
      class="flex items-start gap-2 select-none"
      :class="display.hasDetails && 'cursor-pointer hover:bg-white/[0.03] -mx-1 px-1 rounded'"
      @click="display.hasDetails && (expanded = !expanded)"
    >
      <Loader2 v-if="call.state === 'running'" class="mt-1 size-3 shrink-0 text-[var(--app-accent)] animate-spin" />
      <Check v-else-if="call.state === 'done'" class="mt-1 size-3 shrink-0 text-[var(--app-accent)]" />
      <X v-else class="mt-1 size-3 shrink-0 text-red-400" />
      <span class="min-w-0 flex-1">
        <span class="text-[var(--app-accent)]">{{ display.displayName }}</span>
        <span v-if="display.primaryArg && !expanded" class="text-app-muted/70">('{{ display.shortArg }}')</span>
      </span>
      <button
        v-if="call.state === 'running'"
        class="rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200 transition hover:bg-red-500/15"
        @click.stop="emit('stop')"
      >
        <Square class="mr-1 inline size-3" />
        Stop
      </button>
      <template v-if="display.hasDetails">
        <ChevronUp v-if="expanded" class="size-3 mt-1 shrink-0 text-app-muted/30" />
        <ChevronDown v-else class="size-3 mt-1 shrink-0 text-app-muted/30" />
      </template>
    </div>
    <div v-if="expanded" class="ml-5 mt-1 mb-1.5 space-y-1.5">
      <div v-if="display.primaryArg" class="rounded-lg bg-black/30 px-3 py-2 text-[11px] text-app-muted/80 whitespace-pre-wrap break-all">{{ display.primaryArg }}</div>
      <div v-if="call.result" class="rounded-lg px-3 py-2 text-[11px] whitespace-pre-wrap break-all" :class="call.isError ? 'bg-red-500/10 text-red-300/80' : 'bg-[var(--app-accent)]/8 text-[var(--app-accent)]/70'">{{ call.result }}</div>
    </div>
  </div>
</template>
