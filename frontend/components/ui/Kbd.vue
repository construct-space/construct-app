<script setup lang="ts">
/**
 * Kbd - Keyboard shortcut display
 */
const props = withDefaults(defineProps<{
  keys: string | string[]
  size?: 'xs' | 'sm' | 'md'
}>(), {
  size: 'sm',
})

const isMac = computed(() => {
  if (typeof navigator === 'undefined') return true
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
})

const symbolMap: Record<string, string> = {
  cmd: '\u2318',
  command: '\u2318',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: '\u2325',
  option: '\u2325',
  shift: '\u21E7',
  enter: '\u21A9',
  return: '\u21A9',
  backspace: '\u232B',
  delete: '\u2326',
  escape: 'Esc',
  esc: 'Esc',
  tab: '\u21E5',
  space: '\u2423',
  up: '\u2191',
  down: '\u2193',
  left: '\u2190',
  right: '\u2192',
}

const macSymbolMap: Record<string, string> = {
  ...symbolMap,
  ctrl: '\u2303',
  control: '\u2303',
}

const parsedKeys = computed(() => {
  const raw = Array.isArray(props.keys)
    ? props.keys
    : props.keys.split('+').map(k => k.trim())

  const map = isMac.value ? macSymbolMap : symbolMap

  return raw.map(key => {
    const lower = key.toLowerCase()
    // On Mac, map Ctrl to Cmd automatically
    if (isMac.value && (lower === 'ctrl' || lower === 'control')) {
      return '\u2318'
    }
    return map[lower] || key.charAt(0).toUpperCase() + key.slice(1)
  })
})

const sizeClasses = computed(() => {
  const map: Record<string, string> = {
    xs: 'min-w-[16px] h-4 px-1 text-[10px]',
    sm: 'min-w-[20px] h-5 px-1.5 text-[11px]',
    md: 'min-w-[24px] h-6 px-2 text-xs',
  }
  return map[props.size] || map.sm
})

const separatorSize = computed(() => {
  const map: Record<string, string> = {
    xs: 'text-[9px]',
    sm: 'text-[10px]',
    md: 'text-[11px]',
  }
  return map[props.size] || map.sm
})
</script>

<template>
  <span class="inline-flex items-center gap-0.5">
    <template v-for="(key, i) in parsedKeys" :key="i">
      <span
        v-if="i > 0"
        :class="['text-[var(--app-muted)] opacity-60', separatorSize]"
      >+</span>
      <kbd
        :class="[
          'inline-flex items-center justify-center rounded-[4px] font-sans font-medium leading-none',
          'border border-[var(--app-border)] bg-[var(--app-background)] text-[var(--app-muted)]',
          'shadow-[0_1px_0_0_var(--app-border)]',
          sizeClasses,
        ]"
      >{{ key }}</kbd>
    </template>
  </span>
</template>
