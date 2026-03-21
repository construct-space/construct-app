<script setup lang="ts">
/**
 * Skeleton - Loading placeholder with pulse animation
 * Supports rectangular, rounded, circle, and multi-line text modes
 */
const props = withDefaults(defineProps<{
  width?: string
  height?: string
  rounded?: boolean
  circle?: boolean
  lines?: number
}>(), {
  rounded: false,
  circle: false,
  lines: 0,
})

const style = computed(() => {
  if (props.circle) {
    const size = props.width || props.height || '2.5rem'
    return { width: size, height: size }
  }
  return {
    width: props.width || '100%',
    height: props.lines > 0 ? undefined : (props.height || '1rem'),
  }
})

const shapeClass = computed(() => {
  if (props.circle) return 'rounded-full'
  if (props.rounded) return 'rounded-lg'
  return 'rounded-md'
})

const lineWidths = computed(() => {
  if (props.lines <= 0) return []
  return Array.from({ length: props.lines }, (_, i) => {
    if (i === props.lines - 1 && props.lines > 1) return '60%'
    return '100%'
  })
})
</script>

<template>
  <!-- Multi-line text skeleton -->
  <div v-if="lines > 0" class="flex flex-col gap-2" :style="{ width: style.width }">
    <div
      v-for="(w, i) in lineWidths"
      :key="i"
      class="h-3 rounded-md animate-pulse bg-[color-mix(in_srgb,var(--app-muted)_20%,transparent)]"
      :style="{ width: w }"
    />
  </div>

  <!-- Single shape skeleton -->
  <div
    v-else
    :class="['animate-pulse bg-[color-mix(in_srgb,var(--app-muted)_20%,transparent)]', shapeClass]"
    :style="style"
  />
</template>
