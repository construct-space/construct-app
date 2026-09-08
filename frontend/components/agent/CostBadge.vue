<script setup lang="ts">
/**
 * CostBadge — Compact session cost display for the coder toolbar.
 * Shows running cost, token count, and cache hit rate.
 * Expands on hover/click to show full breakdown.
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { CostInfo } from '@/brain/types'
import { Coins, ChevronDown, Zap } from 'lucide-vue-next'

const props = defineProps<{
  cost: CostInfo | null
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

// idle represents "no active session" — chip still renders but reads as
// dimmed zero. Previously the component returned null and the chip
// vanished entirely between turns, which was read as "the session ended"
// by users who'd already pasted the API key.
const idleDisplay = {
  usd: '$0.00',
  tokens: '0',
  input: '0',
  output: '0',
  cacheRead: '0',
  cacheWrite: '0',
  inputUSD: '$0.00',
  outputUSD: '$0.00',
  cacheReadUSD: '$0.00',
  cacheWriteUSD: '$0.00',
  cacheHit: '—',
  hasBudget: false,
  budgetPct: 0,
  warning: false,
  exceeded: false,
  idle: true,
}

const costDisplay = computed(() => {
  if (!props.cost) return idleDisplay
  const c = props.cost
  return {
    usd: formatUSD(c.costUSD),
    tokens: formatTokens(c.totalTokens),
    input: formatTokens(c.inputTokens),
    output: formatTokens(c.outputTokens),
    cacheRead: formatTokens(c.cacheRead),
    cacheWrite: formatTokens(c.cacheWrite),
    inputUSD: formatUSD(c.inputCostUSD),
    outputUSD: formatUSD(c.outputCostUSD),
    cacheReadUSD: formatUSD(c.cacheReadCostUSD),
    cacheWriteUSD: formatUSD(c.cacheWriteCostUSD),
    cacheHit: `${Math.round(c.cacheHitRate * 100)}%`,
    hasBudget: c.budgetUSD > 0,
    budgetPct: Math.round(c.usedPct * 100),
    warning: c.warning,
    exceeded: c.exceeded,
    idle: false,
  }
})

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatUSD(n: number): string {
  if (n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  if (n < 10) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <!-- Compact badge -->
    <button
      class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)]"
      :class="[
        costDisplay.exceeded ? 'text-red-400' :
        costDisplay.warning ? 'text-amber-400' :
        costDisplay.idle ? 'text-[var(--app-muted)]/60 hover:text-[var(--app-muted)]' :
        'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'
      ]"
      @click="expanded = !expanded"
    >
      <Coins class="size-3" />
      <span>{{ costDisplay.usd }}</span>
      <span class="text-[var(--app-muted)]/60">{{ costDisplay.tokens }}</span>
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
        class="absolute right-0 top-full mt-1 z-[1000] w-56 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-lg p-3 space-y-2.5"
      >
        <!-- Cost header -->
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold text-[var(--app-foreground)]">Session Cost</span>
          <span
            class="text-[12px] font-bold"
            :class="costDisplay.exceeded ? 'text-red-400' : costDisplay.warning ? 'text-amber-400' : costDisplay.idle ? 'text-[var(--app-muted)]' : 'text-[var(--app-accent)]'"
          >{{ costDisplay.usd }}</span>
        </div>

        <!-- Idle notice -->
        <div v-if="costDisplay.idle" class="text-[10px] text-[var(--app-muted)]">
          No active session — start a turn to record cost.
        </div>

        <!-- Budget bar -->
        <div v-if="costDisplay.hasBudget" class="space-y-0.5">
          <div class="h-1.5 rounded-full bg-[var(--app-foreground)]/5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="costDisplay.exceeded ? 'bg-red-400' : costDisplay.warning ? 'bg-amber-400' : 'bg-[var(--app-accent)]'"
              :style="{ width: Math.min(100, costDisplay.budgetPct) + '%' }"
            />
          </div>
          <div class="text-[9px] text-[var(--app-muted)]">{{ costDisplay.budgetPct }}% of budget</div>
        </div>

        <!-- Token + $ breakdown. Three columns: label, tokens, $ —
             puts the dominant line item visually obvious. -->
        <div class="space-y-1 text-[10px]">
          <div class="grid grid-cols-[1fr_auto_auto] gap-x-2 text-[var(--app-muted)]">
            <span>Input tokens</span>
            <span class="text-[var(--app-foreground)]/70 tabular-nums">{{ costDisplay.input }}</span>
            <span class="text-[var(--app-foreground)]/70 tabular-nums">{{ costDisplay.inputUSD }}</span>
          </div>
          <div class="grid grid-cols-[1fr_auto_auto] gap-x-2 text-[var(--app-muted)]">
            <span>Output tokens</span>
            <span class="text-[var(--app-foreground)]/70 tabular-nums">{{ costDisplay.output }}</span>
            <span class="text-[var(--app-foreground)]/70 tabular-nums">{{ costDisplay.outputUSD }}</span>
          </div>
          <div v-if="props.cost && (props.cost.cacheRead > 0 || props.cost.cacheWrite > 0)" class="border-t border-[var(--app-border)]/30 pt-1 mt-1 space-y-1">
            <div class="grid grid-cols-[1fr_auto_auto] gap-x-2 text-[var(--app-muted)]">
              <span class="flex items-center gap-1"><Zap class="size-2.5" /> Cache read</span>
              <span class="text-[var(--app-foreground)]/70 tabular-nums">{{ costDisplay.cacheRead }}</span>
              <span class="text-[var(--app-foreground)]/70 tabular-nums">{{ costDisplay.cacheReadUSD }}</span>
            </div>
            <div class="grid grid-cols-[1fr_auto_auto] gap-x-2 text-[var(--app-muted)]">
              <span>Cache write</span>
              <span class="text-[var(--app-foreground)]/70 tabular-nums">{{ costDisplay.cacheWrite }}</span>
              <span class="text-[var(--app-foreground)]/70 tabular-nums">{{ costDisplay.cacheWriteUSD }}</span>
            </div>
            <div class="flex justify-between text-[var(--app-muted)]">
              <span>Cache hit rate</span>
              <span class="text-emerald-400">{{ costDisplay.cacheHit }}</span>
            </div>
          </div>
        </div>

        <!-- Total -->
        <div class="border-t border-[var(--app-border)]/30 pt-1.5 flex justify-between text-[10px]">
          <span class="text-[var(--app-muted)] font-medium">Total tokens</span>
          <span class="text-[var(--app-foreground)] font-semibold">{{ costDisplay.tokens }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>
