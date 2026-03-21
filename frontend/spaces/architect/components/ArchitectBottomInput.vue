<script setup lang="ts">
/**
 * ArchitectBottomInput - Bottom input bar with Expand and Attach buttons
 */
const props = defineProps<{
  placeholder?: string
  disabled?: boolean
  showExpand?: boolean
}>()

const emit = defineEmits<{
  submit: [text: string]
  expand: [text: string]
  attach: []
}>()

const inputText = ref('')
const inputEl = ref<HTMLInputElement>()

function handleSubmit() {
  const text = inputText.value.trim()
  if (!text || props.disabled) return
  emit('submit', text)
  inputText.value = ''
}

function handleExpand() {
  const text = inputText.value.trim()
  if (!text) return
  emit('expand', text)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}

defineExpose({
  focus: () => inputEl.value?.focus(),
})
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-3 border-t border-[var(--app-border)]/30">
    <!-- Attach button (future file/screenshot uploads) -->
    <button
      class="w-9 h-9 rounded-full flex items-center justify-center text-app-muted hover:text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-background),white_8%)] transition-colors shrink-0"
      @click="emit('attach')"
    >
      <Icon name="i-lucide-plus" class="size-4" />
    </button>

    <!-- Text input -->
    <div class="flex-1 relative">
      <input
        ref="inputEl"
        v-model="inputText"
        :placeholder="placeholder || 'or type your own answer...'"
        :disabled="disabled"
        class="w-full bg-[color-mix(in_srgb,var(--app-background),white_6%)] rounded-full px-4 py-2.5 pr-24 text-sm text-app-foreground placeholder-app-muted/40 outline-none focus:ring-1 focus:ring-[var(--app-accent)]/30 transition-colors disabled:opacity-40"
        @keydown="handleKeydown"
      />

      <!-- Expand button inside input -->
      <button
        v-if="showExpand && inputText.trim()"
        class="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 rounded-md text-xs font-medium bg-[var(--app-accent)]/10 text-[var(--app-accent)] hover:bg-[var(--app-accent)]/20 transition-colors"
        @click="handleExpand"
      >
        Expand
      </button>
    </div>

    <!-- Send button -->
    <button
      class="w-9 h-9 flex items-center justify-center text-app-muted hover:text-[var(--app-accent)] transition-colors shrink-0"
      :class="!inputText.trim() && 'opacity-30 pointer-events-none'"
      @click="handleSubmit"
    >
      <Icon name="i-lucide-send" class="size-4" />
    </button>
  </div>
</template>
