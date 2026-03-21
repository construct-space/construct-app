<script setup lang="ts">
/**
 * Tooltip - Nuxt UI v3 compatible tooltip
 */
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipArrow,
  TooltipProvider,
} from 'reka-ui'

withDefaults(defineProps<{
  text?: string
  content?: { side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end'; sideOffset?: number }
  popper?: { placement?: string }
}>(), {
  text: '',
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="content?.side || 'bottom'"
          :align="content?.align || 'center'"
          :side-offset="content?.sideOffset || 6"
          class="z-[100] rounded-md px-2.5 py-1.5 text-xs font-medium bg-[var(--app-foreground)] text-[var(--app-background)] shadow-md animate-in fade-in-0 zoom-in-95"
        >
          {{ text }}
          <TooltipArrow class="fill-[var(--app-foreground)]" :width="8" :height="4" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
