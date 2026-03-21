<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { ToolActivity } from '@/operator/useStreamStatus'
import VibeToolCallItem from './VibeToolCall.vue'

const props = defineProps<{
  toolHistory: readonly ToolActivity[]
  turn?: number
  maxTurns?: number
  isRunning: boolean
}>()

const emit = defineEmits<{
  stop: []
}>()

const scrollRef = ref<HTMLElement>()
const userScrolledUp = ref(false)

function onScroll() {
  if (!scrollRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.value
  userScrolledUp.value = scrollHeight - scrollTop - clientHeight > 40
}

watch(() => props.toolHistory.length, () => {
  if (userScrolledUp.value) return
  void nextTick(() => {
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' })
  })
})

watch(
  () => props.toolHistory[props.toolHistory.length - 1]?.state,
  () => {
    if (userScrolledUp.value) return
    void nextTick(() => {
      scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' })
    })
  },
)
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-3 py-2 border-b border-app flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-[0.16em] text-app-muted/60 font-medium">Activity</span>
      <span v-if="turn != null" class="text-[10px] text-app-muted/50 font-mono">
        Turn {{ turn }}<template v-if="maxTurns">/{{ maxTurns }}</template>
      </span>
    </div>
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scroll-smooth px-3 py-2 space-y-0.5"
      @scroll="onScroll"
    >
      <template v-if="toolHistory.length === 0">
        <div v-if="isRunning" class="flex items-center gap-2 py-4 justify-center">
          <span class="size-2 rounded-full bg-[#00ff41] animate-pulse" />
          <p class="text-xs text-app-muted/50">Waiting for first tool call...</p>
        </div>
        <p v-else class="text-xs text-app-muted/50 py-4 text-center">
          Tool calls will appear here in real time.
        </p>
      </template>
      <VibeToolCallItem
        v-for="tc in toolHistory"
        :key="tc.callId"
        :call="tc"
        @stop="emit('stop')"
      />
    </div>
    <div v-if="isRunning" class="shrink-0 px-3 py-1.5 border-t border-app">
      <div class="flex items-center gap-2">
        <span class="size-1.5 rounded-full bg-[#00ff41] animate-pulse" />
        <span class="text-[10px] text-app-muted/60">Running</span>
      </div>
    </div>
  </div>
</template>
