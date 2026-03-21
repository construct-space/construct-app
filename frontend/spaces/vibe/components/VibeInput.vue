<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  modelValue: string
  isRunning?: boolean
  queueCount?: number
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'submit': []
}>()

const textareaRef = ref<HTMLTextAreaElement>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (props.modelValue.trim()) {
      emit('submit')
    }
  }
}

function focus() {
  textareaRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="relative">
    <div class="flex gap-2">
      <textarea
        ref="textareaRef"
        :value="modelValue"
        rows="2"
        class="flex-1 rounded-xl border border-app bg-black/20 px-4 py-2.5 text-sm text-app outline-none transition placeholder:text-app-muted/40 focus:border-[#00ff41]/30 focus:ring-1 focus:ring-[#00ff41]/20 resize-none"
        :placeholder="placeholder || (isRunning ? 'Queue a follow-up...' : 'Describe what to build...')"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        class="self-end rounded-xl bg-[#00ff41] px-3 py-2.5 text-sm font-semibold text-black transition hover:bg-[#33ff6a] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!modelValue.trim()"
        @click="emit('submit')"
      >
        <Icon name="i-lucide-arrow-up" class="size-4" />
      </button>
    </div>
    <div
      v-if="queueCount && queueCount > 0"
      class="absolute -top-2 right-12 rounded-full bg-[#00ff41] px-2 py-0.5 text-[10px] font-bold text-black"
    >
      {{ queueCount }} queued
    </div>
  </div>
</template>
