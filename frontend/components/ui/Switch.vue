<script setup lang="ts">
/**
 * Switch — plain implementation, no reka-ui dependency issues
 */
const props = withDefaults(defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
  size?: 'xs' | 'sm' | 'md'
}>(), {
  modelValue: false,
  label: '',
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}

const trackSize: Record<string, string> = {
  xs: 'w-7 h-4',
  sm: 'w-8 h-[18px]',
  md: 'w-10 h-5',
}

const thumbOffset: Record<string, string> = {
  xs: 'translate-x-3',
  sm: 'translate-x-3.5',
  md: 'translate-x-5',
}

const thumbSize: Record<string, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
}
</script>

<template>
  <label
    class="inline-flex items-center gap-2 cursor-pointer select-none"
    :class="disabled ? 'opacity-50 cursor-not-allowed' : ''"
    @click.prevent="toggle"
  >
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      :class="[
        'relative inline-flex shrink-0 rounded-full border-2 border-transparent cursor-pointer transition-colors duration-200',
        modelValue ? 'bg-app-accent' : 'bg-[var(--app-border)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent',
        trackSize[size],
      ]"
      @click.stop="toggle"
    >
      <span
        :class="[
          'block rounded-full bg-white shadow-sm transition-transform duration-200',
          modelValue ? thumbOffset[size] : 'translate-x-0.5',
          thumbSize[size],
        ]"
      />
    </button>
    <span v-if="label" class="text-sm text-[var(--app-foreground)]">{{ label }}</span>
    <slot />
  </label>
</template>
