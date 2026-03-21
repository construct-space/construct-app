<script setup lang="ts">
/**
 * Input — Construct UI
 * Compact dark input with optional prefix/suffix labels.
 * Usage: <Input v-model="w" prefix="W" /> or <Input v-model="val" suffix="%" />
 */
import { Icon } from '@iconify/vue'

const props = withDefaults(defineProps<{
  modelValue?: string | number
  type?: string
  placeholder?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  disabled?: boolean
  required?: boolean
  icon?: string
  trailingIcon?: string
  prefix?: string
  suffix?: string
  variant?: 'outline' | 'soft' | 'none'
  autofocus?: boolean
}>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  size: 'md',
  disabled: false,
  required: false,
  variant: 'outline',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
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

const sizeClasses: Record<string, string> = {
  xs: 'py-0.5 text-xs',
  sm: 'py-1 text-xs',
  md: 'py-1.5 text-sm',
  lg: 'py-2 text-base',
}

const paddingClasses = computed(() => {
  const base: Record<string, string> = {
    xs: 'px-1.5',
    sm: 'px-2',
    md: 'px-2.5',
    lg: 'px-3',
  }
  return base[props.size] || base.md
})

function onInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', props.type === 'number' ? Number(target.value) : target.value)
}
</script>

<template>
  <div
    class="relative inline-flex items-center w-full rounded-md border transition-colors duration-150 overflow-hidden"
    :class="[
      variant === 'none'
        ? 'border-transparent bg-transparent'
        : 'border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-background)_80%,var(--app-canvas-bg)_20%)] hover:border-[var(--app-muted)]/50 focus-within:border-[var(--app-accent)]',
      disabled ? 'opacity-50 cursor-not-allowed' : '',
    ]"
  >
    <!-- Leading icon -->
    <Icon
      v-if="icon && !prefix"
      :icon="toIconify(icon)"
      class="ml-2 shrink-0 size-3.5 text-[var(--app-muted)] pointer-events-none"
    />

    <!-- Prefix label (e.g. "W", "H", "X", "Y") -->
    <span
      v-if="prefix"
      class="shrink-0 px-2 text-[var(--app-muted)] font-medium tabular-nums select-none border-r border-[var(--app-border)]"
      :class="sizeClasses[size]"
    >{{ prefix }}</span>

    <input
      :class="[
        'flex-1 min-w-0 bg-transparent text-[var(--app-foreground)] outline-none',
        'placeholder:text-[var(--app-muted)]/50',
        sizeClasses[size],
        paddingClasses,
        icon && !prefix ? 'pl-1' : '',
        trailingIcon || suffix ? 'pr-0' : '',
      ]"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :autofocus="autofocus"
      @input="onInput"
    />

    <!-- Suffix label (e.g. "%", "px") -->
    <span
      v-if="suffix"
      class="shrink-0 px-2 text-[var(--app-muted)] font-medium select-none border-l border-[var(--app-border)]"
      :class="sizeClasses[size]"
    >{{ suffix }}</span>

    <!-- Trailing icon -->
    <Icon
      v-if="trailingIcon && !suffix"
      :icon="toIconify(trailingIcon)"
      class="mr-2 shrink-0 size-3.5 text-[var(--app-muted)] pointer-events-none"
    />
  </div>
</template>
