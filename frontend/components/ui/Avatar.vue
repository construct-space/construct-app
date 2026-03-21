<script setup lang="ts">
import { computed } from 'vue'
import { AvatarRoot, AvatarImage, AvatarFallback } from 'reka-ui'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    fallback?: string
    size?: 'sm' | 'md' | 'lg'
  }>(),
  {
    src: '',
    alt: '',
    fallback: '',
    size: 'md',
  }
)

const sizeClasses: Record<string, string> = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
}

const classes = computed(() => {
  return [
    'inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden',
    sizeClasses[props.size],
  ]
})
</script>

<template>
  <AvatarRoot :class="classes">
    <AvatarImage
      v-if="src"
      :src="src"
      :alt="alt"
      class="h-full w-full object-cover"
    />
    <AvatarFallback
      class="flex h-full w-full items-center justify-center bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)] font-medium"
      :delay-ms="600"
    >
      {{ fallback }}
    </AvatarFallback>
  </AvatarRoot>
</template>
