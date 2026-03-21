<script setup lang="ts">
/**
 * AgentView — Reusable turn-based agent conversation renderer
 *
 * Renders Turn[] as request bubbles + response blocks.
 * Auto-scrolls on new content. Shows status at bottom.
 * Used by AssistantPanel, Vibe, and any space embedding AI.
 */
import { ref, watch, nextTick } from 'vue'
import type { Turn } from '@/operator/useAgentSession'
import RequestBubble from './RequestBubble.vue'
import ResponseBlocks from './ResponseBlocks.vue'

const props = defineProps<{
  turns: Turn[]
  isLoading?: boolean
  statusMessage?: string
}>()

const scrollRef = ref<HTMLDivElement>()

// Auto-scroll when turns change or content streams
watch(
  () => {
    const len = props.turns.length
    const lastTurn = props.turns[len - 1]
    return `${len}-${lastTurn?.response.length || 0}`
  },
  () => {
    nextTick(() => {
      if (scrollRef.value) {
        scrollRef.value.scrollTop = scrollRef.value.scrollHeight
      }
    })
  },
)
</script>

<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto p-4 space-y-4">
    <!-- Empty state -->
    <div v-if="!turns.length" class="flex flex-col items-center justify-center h-full text-center px-8">
      <slot name="empty">
        <div class="size-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <svg class="size-6 text-app-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p class="text-sm text-app-muted">Ask anything</p>
      </slot>
    </div>

    <!-- Turns -->
    <div v-for="turn in turns" :key="turn.id" class="space-y-2">
      <!-- Request -->
      <RequestBubble :blocks="turn.request" />

      <!-- Response -->
      <div v-if="turn.response.length" class="max-w-[90%]">
        <ResponseBlocks :blocks="turn.response" />
      </div>
    </div>

    <!-- Loading indicator -->
    <div v-if="isLoading" class="flex items-center gap-2 text-app-muted px-1">
      <span class="flex gap-1">
        <span class="size-1.5 rounded-full bg-app-muted animate-bounce" style="animation-delay: 0ms" />
        <span class="size-1.5 rounded-full bg-app-muted animate-bounce" style="animation-delay: 150ms" />
        <span class="size-1.5 rounded-full bg-app-muted animate-bounce" style="animation-delay: 300ms" />
      </span>
      <span class="text-xs">{{ statusMessage || 'Thinking...' }}</span>
    </div>
  </div>
</template>
