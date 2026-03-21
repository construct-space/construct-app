<script setup lang="ts">
/**
 * Slideover - Nuxt UI v3 compatible slide-over panel
 */
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from 'reka-ui'

const props = withDefaults(defineProps<{
  open?: boolean
  title?: string
  side?: 'left' | 'right'
  preventClose?: boolean
}>(), {
  open: false,
  title: '',
  side: 'right',
  preventClose: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  close: []
}>()

function onOpenChange(val: boolean) {
  if (!val && props.preventClose) return
  emit('update:open', val)
  if (!val) emit('close')
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogContent
        :class="[
          'fixed z-50 h-full w-full max-w-md bg-[var(--app-background)] shadow-xl duration-300',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          side === 'left'
            ? 'left-0 top-0 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left'
            : 'right-0 top-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        ]"
      >
        <div v-if="title" class="flex items-center justify-between px-4 py-3 border-b border-[var(--app-border)]">
          <DialogTitle class="text-sm font-semibold text-[var(--app-foreground)]">{{ title }}</DialogTitle>
          <DialogClose
            v-if="!preventClose"
            class="rounded-sm opacity-70 transition-opacity hover:opacity-100 text-[var(--app-muted)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </DialogClose>
        </div>
        <div class="flex-1 overflow-auto">
          <slot />
        </div>
        <div v-if="$slots.footer" class="px-4 py-3 border-t border-[var(--app-border)]">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
