<script setup lang="ts">
/**
 * Icon — resolves i-lucide-* names to bundled lucide-vue-next components.
 * Replaces @iconify/vue for lucide icons (no CDN dependency).
 * Non-lucide names fall through to a simple class-based icon.
 */
import { computed, type Component } from 'vue'
import * as lucideIcons from 'lucide-vue-next'

const props = defineProps<{
  name: string
  size?: number | string
}>()

// Convert icon name to PascalCase lucide key
// Supports: i-lucide-folder-open, lucide:folder-open, folder-open
function toLucideKey(name: string): string {
  return name
    .replace(/^i-lucide-/, '')
    .replace(/^lucide:/, '')
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

const lucideComponent = computed<Component | null>(() => {
  if (!props.name) return null
  // Match i-lucide-*, lucide:*, or bare kebab names that exist in lucide
  if (props.name.startsWith('i-lucide-') || props.name.startsWith('lucide:')) {
    const key = toLucideKey(props.name)
    return (lucideIcons as unknown as Record<string, Component>)[key] || null
  }
  // Try bare name as lucide icon (e.g., "message-circle" → "MessageCircle")
  const key = toLucideKey(props.name)
  const icon = (lucideIcons as unknown as Record<string, Component>)[key]
  return icon || null
})

// Image source: data URIs, http(s) URLs, or paths ending in .svg/.png/.webp/.jpg
const imageSrc = computed<string | null>(() => {
  if (!props.name) return null
  if (props.name.startsWith('data:image/')) return props.name
  if (/^https?:\/\//.test(props.name)) return props.name
  if (/\.(svg|png|webp|jpe?g)(\?|#|$)/i.test(props.name)) return props.name
  return null
})

const sizePx = computed(() => {
  if (props.size == null) return undefined
  return typeof props.size === 'number' ? `${props.size}px` : props.size
})
</script>

<template>
  <component
    v-if="lucideComponent"
    :is="lucideComponent"
    :size="size"
    v-bind="$attrs"
  />
  <img
    v-else-if="imageSrc"
    :src="imageSrc"
    :style="sizePx ? { width: sizePx, height: sizePx, objectFit: 'contain' } : undefined"
    v-bind="$attrs"
  />
  <i v-else :class="name" v-bind="$attrs" />
</template>
