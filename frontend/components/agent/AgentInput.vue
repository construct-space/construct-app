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

async function toggleMic() {
  if (isRecording.value) {
    recognition?.stop()
    isRecording.value = false
    return
  }

  // Check microphone permission first — prevents native TCC crash on macOS
  // when Info.plist isn't embedded (dev builds without .app bundle)
  try {
    const micPermission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    if (micPermission.state === 'denied') return
  } catch {
    // permissions.query not supported — try getUserMedia as fallback
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
    } catch {
      return // no mic access
    }
  }

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognition) return

  recognition = new SpeechRecognition()
  recognition.continuous = false
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
      <!-- Mic -->
      <button
        class="p-2 rounded-xl transition-colors"
        :class="isRecording ? 'text-red-400 bg-red-500/10 animate-pulse' : 'text-app-muted hover:text-app hover:bg-white/5'"
        @click="toggleMic"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
      </button>
      <input
        ref="inputRef"
        v-model="input"
        type="text"
        :placeholder="placeholder || 'Ask anything...'"
        class="flex-1 px-4 py-2.5 text-sm bg-white/40 dark:bg-white/8 rounded-xl border-0 focus:ring-2 focus:ring-(--app-accent)/50 outline-none text-app placeholder-app-muted/50"
        :disabled="disabled"
        @keydown="handleKeydown"
      >
      <!-- Stop button (while loading) -->
      <button
        v-if="loading"
        class="p-2.5 rounded-xl bg-red-500/80 text-white hover:bg-red-500 transition-colors"
        @click="emit('stop')"
      >
        <svg class="size-4" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" /></svg>
      </button>
      <!-- Send button -->
      <button
        v-else
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
