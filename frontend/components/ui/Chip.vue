<script setup lang="ts">
/**
 * Chip - Tag/label chip with optional remove action
 */
const props = withDefaults(defineProps<{
  label?: string
  color?: string
  removable?: boolean
  icon?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'solid' | 'soft' | 'outline'
}>(), {
  color: '',
  removable: false,
  size: 'md',
  variant: 'soft',
})

const emit = defineEmits<{
  remove: []
}>()

const isCustomColor = computed(() => {
  return props.color && (props.color.startsWith('#') || props.color.startsWith('rgb'))
})

const isNamedColor = computed(() => {
  return props.color && !isCustomColor.value
})

const sizeClasses = computed(() => {
  const map: Record<string, string> = {
    sm: 'px-1.5 py-0.5 text-[10px] gap-1',
    md: 'px-2 py-0.5 text-xs gap-1.5',
    lg: 'px-3 py-1 text-sm gap-1.5',
  }
  return map[props.size] || map.md
})

const iconSize = computed(() => {
  const map: Record<string, string> = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  }
  return map[props.size] || map.md
})

const closeSize = computed(() => {
  const map: Record<string, string> = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  }
  return map[props.size] || map.md
})

const namedColorMap: Record<string, Record<string, string>> = {
  solid: {
    red: 'bg-red-500 text-white',
    orange: 'bg-orange-500 text-white',
    amber: 'bg-amber-500 text-white',
    yellow: 'bg-yellow-500 text-white',
    green: 'bg-emerald-500 text-white',
    blue: 'bg-blue-500 text-white',
    purple: 'bg-purple-500 text-white',
    pink: 'bg-pink-500 text-white',
    gray: 'bg-gray-500 text-white',
  },
  soft: {
    red: 'bg-red-500/15 text-red-600 dark:text-red-400',
    orange: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    yellow: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
    green: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
    pink: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
    gray: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
  },
  outline: {
    red: 'border-red-500 text-red-600 dark:text-red-400',
    orange: 'border-orange-500 text-orange-600 dark:text-orange-400',
    amber: 'border-amber-500 text-amber-600 dark:text-amber-400',
    yellow: 'border-yellow-500 text-yellow-600 dark:text-yellow-400',
    green: 'border-emerald-500 text-emerald-600 dark:text-emerald-400',
    blue: 'border-blue-500 text-blue-600 dark:text-blue-400',
    purple: 'border-purple-500 text-purple-600 dark:text-purple-400',
    pink: 'border-pink-500 text-pink-600 dark:text-pink-400',
    gray: 'border-gray-500 text-gray-600 dark:text-gray-400',
  },
}

const variantClasses = computed(() => {
  const v = props.variant

  // Named color (e.g. "red", "blue")
  if (isNamedColor.value) {
    return namedColorMap[v]?.[props.color] || ''
  }

  // Custom hex/rgb color handled via inline styles
  if (isCustomColor.value) {
    if (v === 'outline') return 'border bg-transparent'
    if (v === 'soft') return ''
    return '' // solid
  }

  // Default: use --app-accent
  if (v === 'solid') return 'bg-app-accent text-app-accent-foreground'
  if (v === 'outline') return 'border border-[var(--app-accent)] text-app-accent bg-transparent'
  // soft
  return 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-app-accent'
})

const customStyle = computed(() => {
  if (!isCustomColor.value) return {}
  const c = props.color
  const v = props.variant
  if (v === 'solid') return { backgroundColor: c, color: '#fff' }
  if (v === 'outline') return { borderColor: c, color: c }
  // soft
  return { backgroundColor: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }
})
</script>

<template>
  <span
    :class="[
      'inline-flex items-center rounded-full font-medium',
      variant === 'outline' && !isCustomColor && !isNamedColor ? 'border border-[var(--app-accent)]' : '',
      variant === 'outline' && isNamedColor ? 'border' : '',
      variantClasses,
      sizeClasses,
    ]"
    :style="customStyle"
  >
    <Icon v-if="icon" :name="icon" :class="iconSize" />
    <slot>{{ label }}</slot>
    <button
      v-if="removable"
      type="button"
      class="ml-0.5 inline-flex items-center justify-center rounded-full opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
      @click.stop="emit('remove')"
    >
      <svg
        :class="closeSize"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
      </svg>
    </button>
  </span>
</template>
