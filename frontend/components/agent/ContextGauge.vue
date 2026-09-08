<script setup lang="ts">
/**
 * ContextGauge — Compact context window utilization indicator.
 * Shows a mini arc/bar showing how full the context window is.
 * Expands on click to show char/token breakdown.
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { ContextInfo } from '@/brain/types'
import { Gauge, ChevronDown } from 'lucide-vue-next'

const props = defineProps<{
  context: ContextInfo | null
}>()

const expanded = ref(false)
const rootRef = ref<HTMLElement>()

function onClickOutside(e: MouseEvent) {
  if (expanded.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    expanded.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

// Zero-state for "no active session". Previously we returned null and
// the whole chip vanished between turns; always-rendering keeps the
// toolbar stable and signals readiness.
const idleDisplay = {
  pct: 0,
  tokens: '0',
  tokenLimit: '—',
  chars: '0',
  charLimit: '—',
  messages: 0,
  wasted: '0',
  hasWaste: false,
  warning: false,
  critical: false,
  color: 'text-[var(--app-muted)]/60',
  barColor: 'bg-[var(--app-muted)]/40',
  idle: true,
}

const display = computed(() => {
  if (!props.context) return idleDisplay
  const c = props.context
  // Drive the gauge off tokens — that's the API's real ceiling (1M on
  // Opus 4.7, 200k on legacy). Chars are a local compaction heuristic
  // that can hit 64% of its 80k-char threshold while real token usage
  // is 1% of 1M — showing the char ratio as "Context Window" would
  // trigger premature alarm and compaction.
  const pct = Math.round((c.tokenPct || 0) * 100)
  return {
    pct,
    tokens: formatNum(c.estimatedTokens),
    tokenLimit: formatNum(c.tokenLimit),
    chars: formatNum(c.totalChars),
    charLimit: formatNum(c.charLimit),
    messages: c.totalMessages,
    wasted: formatNum(c.wastedChars),
    hasWaste: c.wastedChars > 1000,
    warning: c.warning,
    critical: c.critical,
    color: c.critical ? 'text-red-400' : c.warning ? 'text-amber-400' : 'text-[var(--app-muted)]',
    barColor: c.critical ? 'bg-red-400' : c.warning ? 'bg-amber-400' : 'bg-[var(--app-accent)]',
    idle: false,
  }
})

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <!-- Compact badge with mini bar -->
    <button
      class="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)]"
      :class="display.color + ' hover:text-[var(--app-foreground)]'"
      @click="expanded = !expanded"
    >
      <Gauge class="size-3" />
      <!-- Mini progress bar -->
      <div class="w-8 h-1.5 rounded-full bg-[var(--app-foreground)]/8 overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="display.barColor"
          :style="{ width: Math.min(100, display.pct) + '%' }"
        />
      </div>
      <span>{{ display.pct }}%</span>
      <ChevronDown class="size-2.5 transition-transform" :class="expanded && 'rotate-180'" />
    </button>

    <!-- Expanded dropdown -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 -translate-y-1"
    >
      <div
        v-if="expanded"
        class="absolute right-0 top-full mt-1 z-[1000] w-52 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-lg p-3 space-y-2.5"
      >
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold text-[var(--app-foreground)]">Context Window</span>
          <span class="text-[12px] font-bold" :class="display.color">{{ display.pct }}%</span>
        </div>

        <!-- Idle notice -->
        <div v-if="display.idle" class="text-[10px] text-[var(--app-muted)]">
          No active session — gauge fills once the agent starts.
        </div>

        <!-- Full progress bar -->
        <div class="space-y-0.5">
          <div class="h-2 rounded-full bg-[var(--app-foreground)]/5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="display.barColor"
              :style="{ width: Math.min(100, display.pct) + '%' }"
            />
          </div>
        </div>

        <!-- Metrics -->
        <div class="space-y-1 text-[10px]">
          <div class="flex justify-between text-[var(--app-muted)]">
            <span>Characters</span>
            <span class="text-[var(--app-foreground)]/70">{{ display.chars }} / {{ display.charLimit }}</span>
          </div>
          <div class="flex justify-between text-[var(--app-muted)]">
            <span>Est. tokens</span>
            <span class="text-[var(--app-foreground)]/70">{{ display.tokens }} / {{ display.tokenLimit }}</span>
          </div>
          <div class="flex justify-between text-[var(--app-muted)]">
            <span>Messages</span>
            <span class="text-[var(--app-foreground)]/70">{{ display.messages }}</span>
          </div>
          <div v-if="display.hasWaste" class="flex justify-between text-amber-400/80">
            <span>Duplicate reads</span>
            <span>{{ display.wasted }} wasted</span>
          </div>
        </div>

        <!-- Warning -->
        <div v-if="display.critical" class="text-[10px] text-red-400 bg-red-400/10 rounded px-2 py-1">
          Context nearly full — old turns will be compacted
        </div>
        <div v-else-if="display.warning" class="text-[10px] text-amber-400 bg-amber-400/10 rounded px-2 py-1">
          Context window filling up ({{ display.pct }}%)
        </div>
      </div>
    </Transition>
  </div>
</template>
