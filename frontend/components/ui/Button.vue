<script setup lang="ts">
/**
 * Button - Nuxt UI v3 compatible button
 * Supports icon, variant, color, size, loading, trailing-icon
 */
import { Icon } from '@iconify/vue'

const props = withDefaults(defineProps<{
  icon?: string
  trailingIcon?: string
  variant?: 'solid' | 'soft' | 'ghost' | 'outline' | 'link'
  color?: 'primary' | 'neutral' | 'warning' | 'info' | 'success' | 'error'
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string
  label?: string
}>(), {
  variant: 'solid',
  color: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  block: false,
})

const slots = defineSlots<{
  default?: () => unknown
  leading?: () => unknown
  trailing?: () => unknown
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

const isIconOnly = computed(() => !slots.default && !props.label && (!!props.icon || !!props.trailingIcon))

const sizeClasses = computed(() => {
  if (isIconOnly.value) {
    const map: Record<string, string> = {
      '2xs': 'size-5',
      xs: 'size-6',
      sm: 'size-7',
      md: 'size-8',
      lg: 'size-9',
    }
    return map[props.size] || map.md
  }
  const map: Record<string, string> = {
    '2xs': 'px-1.5 py-0.5 text-[10px] gap-0.5',
    xs: 'px-2 py-1 text-xs gap-1',
    sm: 'px-2.5 py-1 text-xs gap-1',
    md: 'px-3 py-1.5 text-sm gap-1.5',
    lg: 'px-4 py-2 text-base gap-2',
  }
  return map[props.size] || map.md
})

const iconSize = computed(() => {
  const map: Record<string, string> = {
    '2xs': 'size-3',
    xs: 'size-3.5',
    sm: 'size-4',
    md: 'size-4',
    lg: 'size-5',
  }
  return map[props.size] || map.md
})

const colorVariantClasses = computed(() => {
  const c = props.color
  const v = props.variant
  // Ghost variant
  if (v === 'ghost') {
    if (c === 'neutral') return 'bg-transparent text-current hover:bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)]'
    if (c === 'primary') return 'bg-transparent text-app-accent hover:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]'
    if (c === 'warning') return 'bg-transparent text-amber-500 hover:bg-amber-500/10'
    if (c === 'error') return 'bg-transparent text-red-500 hover:bg-red-500/10'
    return 'bg-transparent text-current hover:bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)]'
  }
  // Soft variant
  if (v === 'soft') {
    if (c === 'primary') return 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-app-accent hover:bg-[color-mix(in_srgb,var(--app-accent)_25%,transparent)]'
    if (c === 'neutral') return 'bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_25%,transparent)]'
    if (c === 'warning') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25'
    if (c === 'error') return 'bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25'
    return 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-app-accent'
  }
  // Outline variant
  if (v === 'outline') {
    return 'border border-[var(--app-border)] bg-transparent text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)]'
  }
  // Link variant
  if (v === 'link') {
    return 'bg-transparent text-app-accent hover:underline p-0!'
  }
  // Solid (default)
  if (c === 'neutral') return 'bg-[var(--app-foreground)]/10 text-[var(--app-foreground)] hover:bg-[var(--app-foreground)]/20'
  if (c === 'warning') return 'bg-amber-500 text-white hover:bg-amber-600'
  if (c === 'error') return 'bg-red-500 text-white hover:bg-red-600'
  return 'bg-app-accent text-app-accent-foreground hover:opacity-90'
})
</script>

<template>
  <component
    :is="to ? 'a' : 'button'"
    :href="to"
    :disabled="disabled || loading"
    :class="[
      'inline-flex items-center justify-center rounded-md font-medium transition-all duration-150 cursor-pointer select-none',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent focus-visible:ring-offset-1',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      sizeClasses,
      colorVariantClasses,
      block ? 'w-full' : '',
    ]"
  >
    <!-- Loading spinner -->
    <svg v-if="loading" class="animate-spin shrink-0" :class="iconSize" viewBox="0 0 24 24" fill="none">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>

    <!-- Leading icon -->
    <Icon v-else-if="icon" :icon="toIconify(icon)" class="shrink-0" :class="iconSize" />

    <!-- Leading slot -->
    <slot name="leading" />

    <!-- Content -->
    <slot>
      <span v-if="label">{{ label }}</span>
    </slot>

    <!-- Trailing slot -->
    <slot name="trailing" />

    <!-- Trailing icon -->
    <Icon v-if="trailingIcon && !loading" :icon="toIconify(trailingIcon)" class="shrink-0" :class="[iconSize, 'opacity-60']" />
  </component>
</template>
