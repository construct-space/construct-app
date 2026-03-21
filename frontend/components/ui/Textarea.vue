<script setup lang="ts">
/**
 * Textarea — Construct UI
 * Compact dark textarea matching the design panel aesthetic.
 */
const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  rows?: number
  size?: 'xs' | 'sm' | 'md' | 'lg'
  disabled?: boolean
  autoresize?: boolean
  variant?: 'outline' | 'none'
}>(), {
  modelValue: '',
  placeholder: '',
  rows: 3,
  size: 'md',
  disabled: false,
  autoresize: false,
  variant: 'outline',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const sizeClasses: Record<string, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-2.5 py-2 text-sm',
  lg: 'px-3 py-2.5 text-base',
}

function onInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
  if (props.autoresize) {
    target.style.height = 'auto'
    target.style.height = target.scrollHeight + 'px'
  }
}
</script>

<template>
  <textarea
    :class="[
      'w-full rounded-md border transition-colors duration-150 resize-y',
      'text-[var(--app-foreground)] placeholder:text-[var(--app-muted)]/50 outline-none',
      'focus:border-[var(--app-accent)]',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      variant === 'none'
        ? 'border-transparent bg-transparent'
        : 'border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-background)_80%,var(--app-canvas-bg)_20%)] hover:border-[var(--app-muted)]/50',
      sizeClasses[size],
    ]"
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows"
    :disabled="disabled"
    @input="onInput"
  />
</template>
