<script setup lang="ts">
/**
 * Pagination - Nuxt UI v3 compatible pagination
 */
import { Icon } from '@iconify/vue'

const props = withDefaults(defineProps<{
  modelValue?: number
  total?: number
  pageCount?: number
  disabled?: boolean
}>(), {
  modelValue: 1,
  total: 0,
  pageCount: 10,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const totalPages = computed(() => Math.ceil(props.total / props.pageCount) || 1)

const visiblePages = computed(() => {
  const pages: (number | '...')[] = []
  const current = props.modelValue
  const total = totalPages.value
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push('...')
    const start = Math.max(2, current - 1)
    const end = Math.min(total - 1, current + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    if (current < total - 2) pages.push('...')
    pages.push(total)
  }
  return pages
})

function goTo(page: number) {
  if (page >= 1 && page <= totalPages.value) {
    emit('update:modelValue', page)
  }
}
</script>

<template>
  <nav class="flex items-center gap-1">
    <button
      :disabled="disabled || modelValue <= 1"
      class="inline-flex items-center justify-center size-8 rounded-md text-sm text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed"
      @click="goTo(modelValue - 1)"
    >
      <Icon icon="lucide:chevron-left" class="size-4" />
    </button>
    <template v-for="(page, i) in visiblePages" :key="i">
      <span v-if="page === '...'" class="px-1 text-[var(--app-muted)]">...</span>
      <button
        v-else
        :disabled="disabled"
        :class="[
          'inline-flex items-center justify-center size-8 rounded-md text-sm font-medium',
          page === modelValue
            ? 'bg-app-accent text-app-accent-foreground'
            : 'text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        ]"
        @click="goTo(page)"
      >
        {{ page }}
      </button>
    </template>
    <button
      :disabled="disabled || modelValue >= totalPages"
      class="inline-flex items-center justify-center size-8 rounded-md text-sm text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed"
      @click="goTo(modelValue + 1)"
    >
      <Icon icon="lucide:chevron-right" class="size-4" />
    </button>
  </nav>
</template>
