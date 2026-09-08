<script setup lang="ts">
/**
 * RunControls — session-level action strip for the Space Developer chat.
 *
 * Shows current status (idle / running / error) and exposes quick actions:
 *  - Stop: abort the streaming run via the exposed cancel callback
 *  - Clear: wipe the local chat
 *
 * Intentionally minimal — only the controls the user reaches for mid-build.
 * We avoid baking retry/continue into the first cut; those are better as
 * follow-ups once usage reveals which are actually needed.
 */
import { computed } from 'vue'
import { StopCircle, MessageSquarePlus, Loader2, Circle, AlertCircle, Play } from 'lucide-vue-next'

const props = defineProps<{
  streaming: boolean
  error?: string | null
  messageCount: number
  /**
   * True when the last assistant turn ended on a "dangling promise" — text
   * like "Let me fix both" or "Now I'll run check" — but the model stopped
   * with end_turn instead of continuing. Surfaces a Continue button so the
   * user can nudge the agent with a one-click synthetic continuation.
   */
  canContinue?: boolean
}>()

const emit = defineEmits<{
  stop: []
  clear: []
  continue: []
}>()

const statusLabel = computed(() => {
  if (props.error) return 'error'
  if (props.streaming) return 'running'
  return 'idle'
})

const statusColor = computed(() => {
  if (props.error) return 'rgb(239, 68, 68)'
  if (props.streaming) return 'var(--app-accent)'
  return 'var(--app-muted)'
})
</script>

<template>
  <div
    class="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-t"
    style="border-color: var(--app-border); background: var(--app-surface); color: var(--app-muted)"
  >
    <Loader2
      v-if="streaming"
      :size="10"
      class="animate-spin"
      :style="{ color: statusColor }"
    />
    <AlertCircle
      v-else-if="error"
      :size="10"
      :style="{ color: statusColor }"
    />
    <Circle
      v-else
      :size="10"
      :style="{ color: statusColor }"
    />
    <span :style="{ color: statusColor }">{{ statusLabel }}</span>
    <span v-if="messageCount > 0" style="color: var(--app-muted); opacity: 0.7">
      · {{ messageCount }} msg
    </span>
    <div class="flex-1" />
    <button
      v-if="streaming"
      type="button"
      class="inline-flex items-center gap-1 px-2 py-0.5 rounded transition"
      style="background: rgba(239, 68, 68, 0.1); color: rgb(239, 68, 68); border: 1px solid rgba(239, 68, 68, 0.25)"
      @click="emit('stop')"
    >
      <StopCircle :size="10" />
      stop
    </button>
    <template v-else>
      <!-- "Continue" appears ONLY when the agent wrote something like "Let me
           fix both" and then stopped with end_turn. One-click nudge reuses
           the active operator session so no context is lost. -->
      <button
        v-if="canContinue"
        type="button"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded transition"
        style="background: color-mix(in srgb, var(--app-accent) 14%, transparent); color: var(--app-accent); border: 1px solid color-mix(in srgb, var(--app-accent) 35%, transparent)"
        title="The agent implied more work but ended the turn — click to continue"
        @click="emit('continue')"
      >
        <Play :size="10" />
        continue
      </button>
      <button
        v-if="messageCount > 0"
        type="button"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded transition hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)]"
        style="color: var(--app-muted); border: 1px solid var(--app-border)"
        title="Start a new thread — clears local history and forgets the operator session"
        @click="emit('clear')"
      >
        <MessageSquarePlus :size="10" />
        new thread
      </button>
    </template>
  </div>
</template>
