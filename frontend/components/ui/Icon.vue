<script setup lang="ts">
/**
 * Icon - Nuxt UI compatible icon component
 * Converts i-lucide-* names to @iconify/vue format
 */
import { Icon as IconifyIcon } from '@iconify/vue'

const props = defineProps<{
  name?: string
}>()

// Convert i-lucide-check → lucide:check
// Convert i-heroicons-check → heroicons:check
const iconName = computed(() => {
  const n = props.name || ''
  if (n.startsWith('i-')) {
    const stripped = n.slice(2)
    const colonIdx = stripped.indexOf('-')
    if (colonIdx > 0) {
      return stripped.slice(0, colonIdx) + ':' + stripped.slice(colonIdx + 1)
    }
    return stripped
  }
  return n
})

// Guard: only render if the resolved name looks like a valid icon identifier
// (e.g. "lucide:check", "mdi:home"). Reject plain text / sentences.
const isValid = computed(() => {
  const n = iconName.value
  return n.length > 0 && n.length < 80 && !n.includes(' ')
})
</script>

<template>
  <IconifyIcon v-if="name && isValid" :icon="iconName" />
</template>
