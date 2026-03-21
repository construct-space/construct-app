<script setup lang="ts">
/**
 * Modal - Nuxt UI v3 compatible modal
 * Supports: #header, #body, #footer, #trigger slots + title/description props
 */
import {
  DialogRoot,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'

const props = withDefaults(defineProps<{
  open?: boolean
  title?: string
  description?: string
  fullscreen?: boolean
  preventClose?: boolean
  ui?: Record<string, string>
}>(), {
  open: false,
  title: '',
  description: '',
  fullscreen: false,
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
  <DialogRoot
    :open="open"
    @update:open="onOpenChange"
  >
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogContent
        :class="[
          'fixed z-50 bg-[var(--app-background)] shadow-xl duration-200 overflow-hidden flex flex-col',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          fullscreen
            ? 'inset-2 rounded-xl'
            : [
                'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--app-border)]',
                ui?.content || 'w-full max-w-lg',
              ],
        ]"
      >
        <!-- Header: slot or title/description props -->
        <div v-if="$slots.header || title || description" class="p-6 pb-0 shrink-0">
          <slot name="header">
            <div class="flex flex-col gap-1.5">
              <DialogTitle v-if="title" class="text-lg font-semibold text-[var(--app-foreground)]">{{ title }}</DialogTitle>
              <DialogDescription v-if="description" class="text-sm text-[var(--app-muted)]">{{ description }}</DialogDescription>
            </div>
          </slot>
        </div>

        <!-- Body / Content -->
        <div class="p-6 text-[var(--app-foreground)] flex-1 overflow-auto">
          <slot name="body">
            <slot name="content">
              <slot />
            </slot>
          </slot>
        </div>

        <!-- Footer -->
        <div v-if="$slots.footer" class="px-6 pb-6 shrink-0">
          <slot name="footer" />
        </div>

        <!-- Close button -->
        <DialogClose
          v-if="!preventClose"
          class="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none text-[var(--app-muted)]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
