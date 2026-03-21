<script setup lang="ts">
/**
 * Badge - Nuxt UI v3 compatible badge
 */
const props = withDefaults(defineProps<{
  color?: 'primary' | 'neutral' | 'success' | 'warning' | 'error' | 'info'
  variant?: 'solid' | 'soft' | 'subtle' | 'outline'
  size?: 'xs' | 'sm' | 'md'
  label?: string
}>(), {
  color: 'primary',
  variant: 'soft',
  size: 'sm',
})

const colorVariantClasses = computed(() => {
  const c = props.color
  const v = props.variant
  if (v === 'soft' || v === 'subtle') {
    const map: Record<string, string> = {
      primary: 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-app-accent',
      neutral: 'bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] text-[var(--app-muted)]',
      success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      error: 'bg-red-500/15 text-red-600 dark:text-red-400',
      info: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    }
    return map[c] || map.primary
  }
  if (v === 'outline') {
    return 'border border-current bg-transparent'
  }
  // solid
  const map: Record<string, string> = {
    primary: 'bg-app-accent text-app-accent-foreground',
    neutral: 'bg-[var(--app-foreground)] text-[var(--app-background)]',
    success: 'bg-emerald-500 text-white',
    warning: 'bg-amber-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-blue-500 text-white',
  }
  return map[c] || map.primary
})

const sizeClasses = computed(() => {
  const map: Record<string, string> = {
    xs: 'px-1.5 py-0.5 text-[10px]',
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
  }
  return map[props.size] || map.sm
})
</script>

<template>
  <span :class="['inline-flex items-center rounded-full font-medium', colorVariantClasses, sizeClasses]">
    <slot>{{ label }}</slot>
  </span>
</template>
