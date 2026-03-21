<script setup lang="ts">
/**
 * Switch - Nuxt UI v3 compatible switch
 */
import { SwitchRoot, SwitchThumb } from 'reka-ui'

withDefaults(defineProps<{
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

const trackSize: Record<string, string> = {
  xs: 'w-7 h-4',
  sm: 'w-8 h-[18px]',
  md: 'w-10 h-5',
}

const thumbSize: Record<string, string> = {
  xs: 'size-3 data-[state=checked]:translate-x-3',
  sm: 'size-3.5 data-[state=checked]:translate-x-3.5',
  md: 'size-4 data-[state=checked]:translate-x-5',
}
</script>

<template>
  <label class="inline-flex items-center gap-2 cursor-pointer" :class="disabled ? 'opacity-50 cursor-not-allowed' : ''">
    <SwitchRoot
      :checked="modelValue"
      :disabled="disabled"
      :class="[
        'relative inline-flex shrink-0 rounded-full border-2 border-transparent cursor-pointer transition-colors',
        'data-[state=checked]:bg-app-accent data-[state=unchecked]:bg-[var(--app-border)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent',
        trackSize[size],
      ]"
      @update:checked="emit('update:modelValue', $event)"
    >
      <SwitchThumb
        :class="[
          'block rounded-full bg-white shadow-sm transition-transform',
          'data-[state=unchecked]:translate-x-0.5',
          thumbSize[size],
        ]"
      />
    </SwitchRoot>
    <span v-if="label" class="text-sm text-[var(--app-foreground)]">{{ label }}</span>
    <slot />
  </label>
</template>
