<script setup lang="ts">
/**
 * SelectMenu - Nuxt UI v3 compatible searchable select
 */
import { Icon } from '@iconify/vue'
import {
  SelectRoot,
  SelectTrigger,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  SelectValue,
} from 'reka-ui'

export interface SelectOption {
  label: string
  value?: string | number | null
  icon?: string
  disabled?: boolean
  description?: string
  type?: string
  [key: string]: unknown
}

const props = withDefaults(defineProps<{
  modelValue?: string | number | null
  options?: SelectOption[] | string[]
  items?: SelectOption[] | SelectOption[][] | string[]
  placeholder?: string
  searchable?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
  disabled?: boolean
  icon?: string
  variant?: 'outline' | 'soft' | 'none'
  valueAttribute?: string
  valueKey?: string
  optionAttribute?: string
}>(), {
  modelValue: null,
  options: () => [],
  placeholder: 'Select...',
  searchable: false,
  size: 'md',
  disabled: false,
  valueAttribute: 'value',
  optionAttribute: 'label',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
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

const normalizedOptions = computed((): SelectOption[] => {
  const raw = props.items?.length ? props.items : props.options
  if (!raw) return []
  return raw.map(opt => {
    if (typeof opt === 'string') return { label: opt, value: opt }
    return opt as SelectOption
  })
})

const selectedLabel = computed(() => {
  const opt = normalizedOptions.value.find(o => o.value === props.modelValue)
  return opt?.label || ''
})

function onValueChange(val: string) {
  emit('update:modelValue', val)
  emit('change', val)
}

const sizeClasses: Record<string, string> = {
  xs: 'px-2 py-0.5 text-xs',
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-base',
}
</script>

<template>
  <SelectRoot
    :model-value="modelValue != null ? String(modelValue) : undefined"
    @update:model-value="onValueChange"
  >
    <SelectTrigger
      :disabled="disabled"
      :class="[
        'inline-flex items-center justify-between gap-2 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-background)] text-[var(--app-foreground)]',
        'focus:border-[var(--app-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        sizeClasses[size],
      ]"
    >
      <div class="flex items-center gap-2 truncate">
        <Icon v-if="icon" :icon="toIconify(icon)" class="size-4 shrink-0 text-[var(--app-muted)]" />
        <SelectValue :placeholder="placeholder">
          {{ selectedLabel || placeholder }}
        </SelectValue>
      </div>
      <Icon icon="lucide:chevron-down" class="size-3.5 shrink-0 opacity-50" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        class="z-[100] min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl"
        position="popper"
        :side-offset="4"
      >
        <SelectViewport class="p-1 max-h-64">
          <SelectItem
            v-for="opt in normalizedOptions"
            :key="String(opt.value)"
            :value="String(opt.value)"
            :disabled="opt.disabled"
            class="relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--app-foreground)] outline-none cursor-pointer select-none data-[highlighted]:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] data-[highlighted]:text-[var(--app-accent)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          >
            <SelectItemIndicator class="absolute left-1">
              <Icon icon="lucide:check" class="size-3.5" />
            </SelectItemIndicator>
            <div class="pl-5 flex items-center gap-2">
              <Icon v-if="opt.icon" :icon="toIconify(opt.icon)" class="size-4 shrink-0" />
              <SelectItemText>{{ opt.label }}</SelectItemText>
            </div>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
