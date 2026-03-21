<script setup lang="ts">
/**
 * Checkbox - Nuxt UI v3 compatible checkbox
 */
import {
  CheckboxRoot,
  CheckboxIndicator,
} from 'reka-ui'

withDefaults(defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
  color?: string
}>(), {
  modelValue: false,
  label: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <label class="inline-flex items-center gap-2 cursor-pointer" :class="disabled ? 'opacity-50 cursor-not-allowed' : ''">
    <CheckboxRoot
      :checked="modelValue"
      :disabled="disabled"
      class="size-4 shrink-0 rounded border border-[var(--app-border)] bg-[var(--app-background)] transition-colors data-[state=checked]:bg-app-accent data-[state=checked]:border-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
      @update:checked="emit('update:modelValue', $event as boolean)"
    >
      <CheckboxIndicator class="flex items-center justify-center text-app-accent-foreground">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      </CheckboxIndicator>
    </CheckboxRoot>
    <span v-if="label" class="text-sm text-[var(--app-foreground)]">{{ label }}</span>
    <slot />
  </label>
</template>
