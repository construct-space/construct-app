<script setup lang="ts">
/**
 * Empty - Empty state placeholder
 * Centered layout with icon, title, description, and action slot
 */
import { Icon } from '@iconify/vue'

const props = defineProps<{
  icon?: string
  title?: string
  description?: string
}>()

function toIconify(name: string) {
  if (name.startsWith('i-')) {
    const stripped = name.slice(2)
    const idx = stripped.indexOf('-')
    if (idx > 0) return stripped.slice(0, idx) + ':' + stripped.slice(idx + 1)
    return stripped
  }
  return name
}
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
    <div
      v-if="icon"
      class="mb-3 flex items-center justify-center size-12 rounded-full bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)]"
    >
      <Icon
        :icon="toIconify(icon)"
        class="size-6 text-[var(--app-muted)]"
      />
    </div>

    <h3
      v-if="title"
      class="text-sm font-medium text-[var(--app-foreground)]"
    >
      {{ title }}
    </h3>

    <p
      v-if="description"
      :class="['text-xs text-[var(--app-muted)] max-w-xs', title ? 'mt-1' : '']"
    >
      {{ description }}
    </p>

    <div v-if="$slots.default" :class="[title || description ? 'mt-4' : '']">
      <slot />
    </div>
  </div>
</template>
