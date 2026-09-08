<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface Props {
  name: string
  avatar?: string | null
  /** Pixel size (square). Defaults to 40. */
  size?: number
  /** Deterministic color fallback when no avatar — pass profile index. */
  index?: number
}

const props = withDefaults(defineProps<Props>(), {
  avatar: null,
  size: 40,
  index: 0,
})

// Track image-load failures so a stale CDN URL falls back to initials
// instead of rendering a broken-image icon.
const failed = ref(false)
watch(() => props.avatar, () => { failed.value = false })

const showImage = computed(() => !!props.avatar && !failed.value)

const initials = computed(() => {
  return (props.name || '?')
    .split(/[\s-]+/)
    .map(w => w[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('') || '?'
})

// Six-step palette — keeps avatars visually distinct without depending on
// hashing. Caller passes index for stable assignment across renders.
const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500']
const colorClass = computed(() => colors[Math.abs(props.index) % colors.length])

// Scale typography with size so initials stay readable from 24px to 96px.
const fontSize = computed(() => Math.round(props.size * 0.4))
</script>

<template>
  <div
    class="rounded-full overflow-hidden flex items-center justify-center shrink-0"
    :class="!showImage ? `${colorClass} text-white font-bold` : ''"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${fontSize}px` }"
  >
    <img
      v-if="showImage"
      :src="avatar || ''"
      :alt="name"
      class="w-full h-full object-cover"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <span v-else>{{ initials }}</span>
  </div>
</template>
