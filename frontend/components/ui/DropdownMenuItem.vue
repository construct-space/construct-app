<script setup lang="ts">
/**
 * DropdownMenuItem - standalone dropdown menu item
 * Used when DropdownMenu content is built manually (not via items prop)
 */
import { Icon } from '@iconify/vue'
import { DropdownMenuItem } from 'reka-ui'

withDefaults(defineProps<{
  label?: string
  icon?: string
  disabled?: boolean
}>(), {
  label: '',
  icon: '',
  disabled: false,
})

const emit = defineEmits<{
  select: []
}>()

function toIconify(name: string) {
  if (name.startsWith('i-')) {
    const stripped = name.slice(2)
    const idx = stripped.indexOf('-')
    if (idx > 0) return stripped.slice(0, idx) + ':' + stripped.slice(idx + 1)
    return stripped
  }
  return name
}
</script>

<template>
  <DropdownMenuItem
    :disabled="disabled"
    class="relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--app-foreground)] outline-none cursor-pointer select-none data-[highlighted]:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] data-[highlighted]:text-[var(--app-accent)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    @select="emit('select')"
  >
    <Icon v-if="icon" :icon="toIconify(icon)" class="size-4 shrink-0 text-[var(--app-muted)]" />
    <slot>{{ label }}</slot>
  </DropdownMenuItem>
</template>
