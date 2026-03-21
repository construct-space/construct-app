<script setup lang="ts">
/**
 * Alert - Notification banner with color variants
 * Supports title, description, icon, closable dismiss
 */
import { Icon } from '@iconify/vue'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  icon?: string
  color?: 'info' | 'success' | 'warning' | 'error'
  closable?: boolean
}>(), {
  color: 'info',
  closable: false,
})

const emit = defineEmits<{
  close: []
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

const colorClasses = computed(() => {
  const map: Record<string, string> = {
    info: 'border-[var(--app-accent)]/30 bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]',
    success: 'border-emerald-500/30 bg-emerald-500/10',
    warning: 'border-amber-500/30 bg-amber-500/10',
    error: 'border-red-500/30 bg-red-500/10',
  }
  return map[props.color] || map.info
})

const iconColorClass = computed(() => {
  const map: Record<string, string> = {
    info: 'text-[var(--app-accent)]',
    success: 'text-emerald-500',
    warning: 'text-amber-500',
    error: 'text-red-500',
  }
  return map[props.color] || map.info
})

const defaultIcon = computed(() => {
  if (props.icon) return toIconify(props.icon)
  const map: Record<string, string> = {
    info: 'lucide:info',
    success: 'lucide:check-circle',
    warning: 'lucide:alert-triangle',
    error: 'lucide:x-circle',
  }
  return map[props.color] || map.info
})
</script>

<template>
  <div
    :class="[
      'rounded-lg border px-4 py-3 text-[var(--app-foreground)]',
      colorClasses,
    ]"
    role="alert"
  >
    <div class="flex items-start gap-3">
      <Icon
        :icon="defaultIcon"
        :class="['size-4 mt-0.5 shrink-0', iconColorClass]"
      />

      <div class="flex-1 min-w-0">
        <p v-if="title" class="text-sm font-medium">
          {{ title }}
        </p>
        <p
          v-if="description"
          :class="['text-xs text-[var(--app-muted)]', title ? 'mt-0.5' : '']"
        >
          {{ description }}
        </p>
        <div v-if="$slots.default" :class="[title || description ? 'mt-2' : '']">
          <slot />
        </div>
      </div>

      <button
        v-if="closable"
        class="shrink-0 rounded-sm text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors cursor-pointer"
        @click="emit('close')"
      >
        <Icon icon="lucide:x" class="size-3.5" />
      </button>
    </div>
  </div>
</template>
