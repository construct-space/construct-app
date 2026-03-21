<script setup lang="ts">
/**
 * Popover - Nuxt UI v3 compatible popover
 */
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
  PopoverArrow,
} from 'reka-ui'

withDefaults(defineProps<{
  open?: boolean
  content?: { side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end'; sideOffset?: number }
}>(), {
  open: undefined,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
</script>

<template>
  <PopoverRoot
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :side="content?.side || 'bottom'"
        :align="content?.align || 'center'"
        :side-offset="content?.sideOffset || 4"
        class="z-[100] min-w-48 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      >
        <slot name="content" />
        <PopoverArrow class="fill-[var(--app-border)]" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
