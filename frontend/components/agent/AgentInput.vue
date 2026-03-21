<script setup lang="ts">
/**
 * AgentInput — Text input with drag-drop for images/files
 *
 * Emits send(blocks) with text + any dropped images/files.
 */
import { ref } from 'vue'
import type { RequestBlock, ImageBlock } from '@/operator/useAgentSession'

defineProps<{
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  send: [blocks: RequestBlock[]]
}>()

const input = ref('')
const inputRef = ref<HTMLInputElement>()
const attachments = ref<RequestBlock[]>([])
const isDragOver = ref(false)

function handleSend() {
  const blocks: RequestBlock[] = []
  if (input.value.trim()) {
    blocks.push({ type: 'text', content: input.value.trim() })
  }
  blocks.push(...attachments.value)
  if (blocks.length === 0) return

  emit('send', blocks)
  input.value = ''
  attachments.value = []
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (!e.dataTransfer?.files) return

  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        attachments.value.push({
          type: 'image',
          src: reader.result as string,
          alt: file.name,
        })
      }
      reader.readAsDataURL(file)
    } else {
      attachments.value.push({
        type: 'file',
        name: file.name,
        size: file.size,
      })
    }
  }
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1)
}

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div
    class="p-3 border-t border-gray-200/30 dark:border-gray-800/30 shrink-0"
    :class="isDragOver ? 'bg-app-accent/5' : ''"
    @dragover.prevent="isDragOver = true"
    @dragleave="isDragOver = false"
    @drop="handleDrop"
  >
    <!-- Attachment previews -->
    <div v-if="attachments.length" class="flex flex-wrap gap-2 mb-2">
      <div v-for="(att, i) in attachments" :key="i" class="relative group">
        <img
          v-if="att.type === 'image'"
          :src="(att as ImageBlock).src"
          class="size-12 rounded-lg object-cover border border-app-border"
        />
        <div
          v-else
          class="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 text-xs text-app-muted"
        >
          {{ (att as any).name }}
        </div>
        <button
          class="absolute -top-1 -right-1 size-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          @click="removeAttachment(i)"
        >×</button>
      </div>
    </div>

    <!-- Input row -->
    <div class="flex items-center gap-2">
      <input
        ref="inputRef"
        v-model="input"
        type="text"
        :placeholder="placeholder || 'Ask anything...'"
        class="flex-1 px-4 py-2.5 text-sm bg-white/40 dark:bg-white/8 rounded-xl border-0 focus:ring-2 focus:ring-(--app-accent)/50 outline-none text-app placeholder-app-muted/50"
        :disabled="disabled"
        @keydown="handleKeydown"
      >
      <button
        class="p-2.5 rounded-xl bg-(--app-accent) text-app-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
        :disabled="(!input.trim() && !attachments.length) || disabled"
        @click="handleSend"
      >
        <svg class="size-4" viewBox="0 0 16 16"><path d="M3 13V3l10 5-10 5z" fill="currentColor" /></svg>
      </button>
    </div>

    <!-- Drop hint -->
    <div v-if="isDragOver" class="mt-2 text-center text-xs text-app-accent">
      Drop images or files here
    </div>
  </div>
</template>
