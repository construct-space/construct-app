<script setup lang="ts">
/**
 * ArchitectThinkingIndicator - Text scramble/decode animation
 *
 * Characters start as random glyphs, then resolve letter-by-letter
 * into the actual message. When the message changes, the current text
 * scrambles out before the new one decodes in.
 */
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps<{
  message?: string
}>()

const displayedText = ref('')
let animFrame: number | null = null
let currentTarget = ''

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*!?<>{}[]~'
const DECODE_SPEED = 30 // ms per resolved character
const SCRAMBLE_CYCLES = 3 // how many random swaps per frame

function randomChar(): string {
  return CHARS[Math.floor(Math.random() * CHARS.length)]
}

function scrambleDecode(target: string) {
  if (animFrame) cancelAnimationFrame(animFrame)
  currentTarget = target

  // Start fully scrambled
  const resolved = new Array(target.length).fill(false)
  const chars = target.split('').map(ch => ch === ' ' ? ' ' : randomChar())
  let resolvedCount = 0
  let lastResolveTime = performance.now()

  function tick(now: number) {
    if (currentTarget !== target) return // aborted, new message incoming

    // Resolve next character if enough time passed
    if (now - lastResolveTime >= DECODE_SPEED && resolvedCount < target.length) {
      // Find next unresolved char (skip spaces)
      while (resolvedCount < target.length && target[resolvedCount] === ' ') {
        resolved[resolvedCount] = true
        chars[resolvedCount] = ' '
        resolvedCount++
      }
      if (resolvedCount < target.length) {
        resolved[resolvedCount] = true
        chars[resolvedCount] = target[resolvedCount]
        resolvedCount++
        lastResolveTime = now
      }
    }

    // Scramble unresolved characters
    for (let cycle = 0; cycle < SCRAMBLE_CYCLES; cycle++) {
      const unresolvedIndices: number[] = []
      for (let i = resolvedCount; i < target.length; i++) {
        if (!resolved[i] && target[i] !== ' ') unresolvedIndices.push(i)
      }
      if (unresolvedIndices.length > 0) {
        const idx = unresolvedIndices[Math.floor(Math.random() * unresolvedIndices.length)]
        chars[idx] = randomChar()
      }
    }

    displayedText.value = chars.join('')

    if (resolvedCount < target.length) {
      animFrame = requestAnimationFrame(tick)
    } else {
      animFrame = null
    }
  }

  // Show initial scrambled state
  displayedText.value = chars.join('')
  animFrame = requestAnimationFrame(tick)
}

watch(() => props.message, (newMsg) => {
  if (newMsg) scrambleDecode(newMsg)
}, { immediate: true })

onUnmounted(() => {
  if (animFrame) cancelAnimationFrame(animFrame)
})
</script>

<template>
  <div class="py-2">
    <div class="thinking-container flex items-center gap-3 rounded-xl px-5 py-3.5">
      <!-- Pulse ring -->
      <div class="relative flex items-center justify-center w-5 h-5 shrink-0">
        <span class="thinking-ring absolute inset-0 rounded-full border border-[var(--app-accent)]/40" />
        <span class="thinking-ring-delayed absolute inset-0 rounded-full border border-[var(--app-accent)]/20" />
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--app-accent)] thinking-core" />
      </div>

      <!-- Scramble text -->
      <span class="text-xs text-app-muted/80 font-mono tracking-wide whitespace-pre">{{ displayedText }}</span>
    </div>
  </div>
</template>

<style scoped>
.thinking-container {
  background: color-mix(in srgb, var(--app-background), white 4%);
  border-left: 2px solid color-mix(in srgb, var(--app-accent), transparent 50%);
}

.thinking-core {
  animation: core-pulse 1.5s ease-in-out infinite;
}

.thinking-ring {
  animation: ring-expand 2s ease-out infinite;
}

.thinking-ring-delayed {
  animation: ring-expand 2s ease-out infinite 0.8s;
}

@keyframes core-pulse {
  0%, 100% { opacity: 0.6; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.1); }
}

@keyframes ring-expand {
  0% { transform: scale(0.5); opacity: 0.6; }
  100% { transform: scale(1.4); opacity: 0; }
}
</style>
