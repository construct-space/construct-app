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

// Convert i-lucide-folder-open → FolderOpen
function toLucideKey(name: string): string {
  return name
    .replace(/^i-lucide-/, '')
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

const lucideComponent = computed<Component | null>(() => {
  if (!props.name?.startsWith('i-lucide-')) return null
  const key = toLucideKey(props.name)
  return (lucideIcons as unknown as Record<string, Component>)[key] || null
})
</script>

<template>
  <component
    v-if="lucideComponent"
    :is="lucideComponent"
    :size="size"
    v-bind="$attrs"
  />
  <i v-else :class="name" v-bind="$attrs" />
</template>
