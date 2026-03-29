<script setup lang="ts">
/**
 * AgentInput — Dock-style input with glassmorphism
 *
 * Emits send(blocks) with text + any dropped images/files.
 */
import { ref } from 'vue'
import type { RequestBlock, ImageBlock } from '@/assistant'

defineProps<{
  disabled?: boolean
  loading?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  send: [blocks: RequestBlock[]]
  stop: []
}>()

const input = ref('')
const inputRef = ref<HTMLInputElement>()
const attachments = ref<RequestBlock[]>([])
const isDragOver = ref(false)
const isRecording = ref(false)
let recognition: any = null

function toggleMic() {
  if (isRecording.value) {
    recognition?.stop()
    isRecording.value = false
    return
  }

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognition) return

  recognition = new SpeechRecognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'en-US'

  recognition.onresult = (e: any) => {
    const transcript = Array.from(e.results as SpeechRecognitionResultList)
      .map((r: any) => r[0].transcript)
      .join('')
    input.value = transcript
  }
  recognition.onend = () => { isRecording.value = false }
  recognition.onerror = () => { isRecording.value = false }

  recognition.start()
  isRecording.value = true
}

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

function handleFileSelect(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of files) {
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
  // Reset input so same file can be selected again
  ;(e.target as HTMLInputElement).value = ''
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
    class="dock-input shrink-0 mx-3 mb-3"
    :class="isDragOver ? 'dock-input--dragover' : ''"
    @dragover.prevent="isDragOver = true"
    @dragleave="isDragOver = false"
    @drop="handleDrop"
  >
    <!-- Attachment previews -->
    <div v-if="attachments.length" class="flex flex-wrap gap-2 px-4 pt-3 pb-1">
      <div v-for="(att, i) in attachments" :key="i" class="relative group">
        <img
          v-if="att.type === 'image'"
          :src="(att as ImageBlock).src"
          class="size-12 rounded-lg object-cover border border-white/20 dark:border-white/10"
        />
        <div
          v-else
          class="flex items-center gap-1 px-2 py-1 rounded-md bg-white/20 dark:bg-white/10 text-xs text-app"
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
    <div class="flex items-center gap-1.5 px-2 py-2">
      <!-- + button (left) — upload/attach -->
      <button
        class="dock-btn"
        @click="($refs.fileInput as HTMLInputElement)?.click()"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        multiple
        accept="image/*,.pdf,.txt,.md,.json,.csv"
        @change="handleFileSelect"
      />

      <!-- Text input -->
      <input
        ref="inputRef"
        v-model="input"
        type="text"
        :placeholder="placeholder || 'Ask anything...'"
        class="dock-text-input"
        :disabled="disabled"
        @keydown="handleKeydown"
      >

      <!-- Stop button (while loading) -->
      <button
        v-if="loading"
        class="dock-btn dock-btn--stop"
        @click="emit('stop')"
      >
        <svg class="size-4" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" /></svg>
      </button>
      <!-- Send button -->
      <button
        v-if="!loading || input.trim()"
        class="dock-btn dock-btn--send"
        :disabled="(!input.trim() && !attachments.length) || disabled"
        @click="handleSend"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
      </button>
      <!-- Mic (right) -->
      <button
        class="dock-btn"
        :class="isRecording ? 'text-red-400 !bg-red-500/15 animate-pulse' : ''"
        @click="toggleMic"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
      </button>
    </div>

    <!-- Drop hint -->
    <div v-if="isDragOver" class="pb-2 text-center text-xs text-app-accent font-medium">
      Drop images or files here
    </div>
  </div>
</template>

<style scoped>
.dock-input {
  position: relative;
  border-radius: 1rem;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.06),
    0 0 0 0.5px rgba(0, 0, 0, 0.04),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.7);
  transition: box-shadow 0.2s, border-color 0.2s;
}

:root.dark .dock-input,
.dark .dock-input {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
  box-shadow:
    0 2px 20px rgba(0, 0, 0, 0.3),
    0 0 0 0.5px rgba(255, 255, 255, 0.06),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.08);
}

.dock-input:focus-within {
  border-color: color-mix(in srgb, var(--app-accent) 40%, transparent);
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.06),
    0 0 0 0.5px rgba(0, 0, 0, 0.04),
    0 0 0 3px color-mix(in srgb, var(--app-accent) 12%, transparent),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.7);
}

:root.dark .dock-input:focus-within,
.dark .dock-input:focus-within {
  border-color: color-mix(in srgb, var(--app-accent) 35%, transparent);
  box-shadow:
    0 2px 20px rgba(0, 0, 0, 0.3),
    0 0 0 0.5px rgba(255, 255, 255, 0.06),
    0 0 0 3px color-mix(in srgb, var(--app-accent) 10%, transparent),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.08);
}

.dock-input--dragover {
  border-color: color-mix(in srgb, var(--app-accent) 50%, transparent);
  background: color-mix(in srgb, var(--app-accent) 5%, rgba(255, 255, 255, 0.55));
}

.dock-text-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  background: transparent;
  border: none;
  outline: none;
  color: var(--app-foreground);
}
.dock-text-input::placeholder {
  color: var(--app-muted);
  opacity: 0.6;
}

.dock-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border-radius: 0.625rem;
  color: var(--app-muted);
  background: transparent;
  transition: background 0.15s, color 0.15s;
  cursor: pointer;
  border: none;
}
.dock-btn:hover {
  color: var(--app-foreground);
  background: rgba(0, 0, 0, 0.05);
}
:root.dark .dock-btn:hover,
.dark .dock-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.dock-btn--send {
  color: var(--app-accent);
  background: color-mix(in srgb, var(--app-accent) 10%, transparent);
}
.dock-btn--send:hover {
  color: white;
  background: var(--app-accent);
}
.dock-btn--send:disabled {
  opacity: 0.3;
  pointer-events: none;
}

.dock-btn--stop {
  color: white;
  background: rgba(239, 68, 68, 0.8);
}
.dock-btn--stop:hover {
  background: rgba(239, 68, 68, 1);
}
</style>
