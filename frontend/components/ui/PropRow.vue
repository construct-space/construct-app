<script setup lang="ts">
/**
 * PropRow — Construct UI
 * Horizontal row for design panel properties.
 * Slots are laid out side by side in equal columns.
 *
 * Usage (two inputs in a row):
 *   <PropRow>
 *     <Input v-model="w" prefix="W" />
 *     <Input v-model="h" prefix="H" />
 *   </PropRow>
 *
 * Usage (label + control, like FormField layout="row"):
 *   <PropRow label="Opacity">
 *     <Input v-model="opacity" suffix="%" />
 *     <Select v-model="blend" :options="blendModes" />
 *   </PropRow>
 */
withDefaults(defineProps<{
  label?: string
  cols?: number
}>(), {
  cols: 0,
})
</script>

<template>
  <div class="flex items-center gap-1.5 px-3 py-0.5">
    <span
      v-if="label"
      class="shrink-0 w-16 text-xs text-[var(--app-muted)] select-none leading-none"
    >{{ label }}</span>
    <div
      class="flex-1 flex items-center gap-1.5"
      :class="cols ? `grid grid-cols-${cols}` : 'flex'"
    >
      <slot />
    </div>
  </div>
</template>
