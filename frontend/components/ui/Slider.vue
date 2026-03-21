<script setup lang="ts">
/**
 * Slider - Nuxt UI v3 compatible slider
 */
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'reka-ui'

const props = withDefaults(defineProps<{
  modelValue?: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  size?: 'xs' | 'sm' | 'md'
}>(), {
  modelValue: 0,
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

function onValueChange(val: number[] | undefined) {
  if (val) emit('update:modelValue', val[0])
}

const trackHeight = computed(() => {
  if (props.size === 'xs') return 'h-1'
  if (props.size === 'sm') return 'h-1.5'
  return 'h-2'
})

const thumbSize = computed(() => {
  if (props.size === 'xs') return 'size-3'
  if (props.size === 'sm') return 'size-3.5'
  return 'size-4'
})
</script>

<template>
  <SliderRoot
    :model-value="[modelValue]"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    class="relative flex items-center w-full select-none touch-none"
    @update:model-value="onValueChange"
  >
    <SliderTrack :class="['relative grow rounded-full bg-[var(--app-border)]', trackHeight]">
      <SliderRange class="absolute h-full rounded-full bg-app-accent" />
    </SliderTrack>
    <SliderThumb
      :class="[
        'block rounded-full bg-white border-2 border-app-accent shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent',
        'disabled:opacity-50',
        thumbSize,
      ]"
    />
  </SliderRoot>
</template>
