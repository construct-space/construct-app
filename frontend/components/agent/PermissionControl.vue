<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { Shield, ShieldAlert, ShieldOff, ShieldBan } from 'lucide-vue-next'
import type { PermissionModeValue } from '@/brain/types'

defineProps<{
  mode: PermissionModeValue
}>()

const emit = defineEmits<{
  (e: 'change', mode: PermissionModeValue): void
}>()

const open = ref(false)

const modes: { value: PermissionModeValue; label: string; desc: string; icon: typeof Shield; color: string }[] = [
  { value: 'default', label: 'Default', desc: 'Run safe tools, no prompts', icon: Shield, color: 'text-[var(--app-muted)]' },
  { value: 'ask', label: 'Ask', desc: 'Prompt before any mutating tool', icon: ShieldAlert, color: 'text-amber-400' },
  { value: 'strict', label: 'Strict', desc: 'Auto-deny mutating tools', icon: ShieldBan, color: 'text-red-400' },
  { value: 'yolo', label: 'YOLO', desc: 'Allow everything, no prompts', icon: ShieldOff, color: 'text-orange-400' },
]

function select(value: PermissionModeValue) {
  open.value = false
  emit('change', value)
}

function toggle() {
  open.value = !open.value
}

function onClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.permission-dropdown')) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <div class="relative permission-dropdown">
    <button
      class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)]"
      :title="`Permission mode: ${mode}`"
      @click="toggle"
    >
      <component
        :is="modes.find(m => m.value === mode)?.icon || Shield"
        class="size-3"
        :class="modes.find(m => m.value === mode)?.color || 'text-[var(--app-muted)]'"
      />
      <span class="text-[var(--app-muted)]">{{ modes.find(m => m.value === mode)?.label || mode }}</span>
    </button>

    <!-- Dropdown -->
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        class="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl py-1"
      >
        <button
          v-for="m in modes"
          :key="m.value"
          class="flex items-start gap-2.5 w-full px-3 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)]"
          :class="mode === m.value && 'bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]'"
          @click="select(m.value)"
        >
          <component :is="m.icon" class="size-3.5 mt-0.5 shrink-0" :class="m.color" />
          <div class="min-w-0">
            <div class="text-[11px] font-medium" :class="mode === m.value ? 'text-[var(--app-foreground)]' : 'text-[var(--app-foreground)]/70'">
              {{ m.label }}
            </div>
            <div class="text-[9px] text-[var(--app-muted)] leading-tight mt-0.5">{{ m.desc }}</div>
          </div>
        </button>
      </div>
    </Transition>
  </div>
</template>
