<script setup lang="ts">
/**
 * AgentInput — Dock-style input with glassmorphism
 *
 * Emits send(blocks) with text + any dropped images/files.
 */
import { ref, computed } from 'vue'
import type { RequestBlock, ImageBlock } from '@/assistant'
import { useAIModel } from '@/composables/useAIModel'

// Drop targets dragged from non-Finder apps (Mail, Preview, browsers)
// don't expose a filesystem path on the File object. Persist the blob
// to a temp file so the agent can read it by path. Returns null in
// non-Tauri environments; callers fall back to a data-URL image block.
async function persistBlobToTmp(file: File, defaultExt = 'bin'): Promise<{ path: string; name: string } | null> {
  const { isTauriEnv } = await import('@/utils/tauri')
  if (!isTauriEnv()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
  const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
  const tmpDir = `${dataDir}/tmp`
  if (!await exists(tmpDir)) await mkdir(tmpDir, { recursive: true })
  const ext = file.name.includes('.') ? file.name.split('.').pop() : (file.type.split('/')[1] || defaultExt)
  const name = file.name || `drop-${Date.now()}.${ext}`
  const path = `${tmpDir}/drop-${Date.now()}-${name}`
  const buffer = await file.arrayBuffer()
  await writeFile(path, new Uint8Array(buffer))
  return { path, name }
}

function toAssetUrl(path: string): string {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc: (p: string, protocol?: string) => string } }).__TAURI_INTERNALS__
    if (internals?.convertFileSrc) return internals.convertFileSrc(path, 'asset')
  }
  return path
}

const props = defineProps<{
  disabled?: boolean
  loading?: boolean
  placeholder?: string
  capabilities?: string[]
  /**
   * Visual treatment. `dock` (default) is the translucent glassmorphism dock
   * used by the main assistant. `editorial` is the clean, solid, brand-accent
   * look (matches the Construct landing page) used by the Builder and Space
   * Developer.
   */
  variant?: 'dock' | 'editorial'
}>()

const { currentModel } = useAIModel()
const modelCapabilities = computed(() => props.capabilities ?? currentModel.value?.capabilities ?? [])
const supportsVision = computed(() => modelCapabilities.value.includes('vision'))
const supportsPdf = computed(() => modelCapabilities.value.includes('pdf_input'))

const acceptTypes = computed(() => {
  const types: string[] = ['.txt', '.md', '.json', '.csv']
  if (supportsVision.value) types.push('image/*')
  if (supportsPdf.value) types.push('.pdf')
  return types.join(',')
})

const emit = defineEmits<{
  send: [blocks: RequestBlock[]]
  stop: []
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

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/') && !supportsVision.value) {
      useNotification().add({ title: 'Image skipped', description: 'The current model does not support images. Switch to a vision-capable model to paste pictures.' })
      e.preventDefault()
      continue
    }
    if (item.type.startsWith('image/') && supportsVision.value) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue

      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (isTauriEnv()) {
          const { invoke } = await import('@tauri-apps/api/core')
          const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
          const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
          const tmpDir = `${dataDir}/tmp`
          if (!await exists(tmpDir)) await mkdir(tmpDir, { recursive: true })
          const fileName = `paste-${Date.now()}.png`
          const filePath = `${tmpDir}/${fileName}`
          const buffer = await file.arrayBuffer()
          await writeFile(filePath, new Uint8Array(buffer))
          attachments.value.push({ type: 'file', name: fileName, path: filePath })
          return
        }
      } catch { /* browser fallback */ }

      const reader = new FileReader()
      reader.onload = () => {
        attachments.value.push({
          type: 'image',
          src: reader.result as string,
          alt: `screenshot-${Date.now()}.png`,
        })
      }
      reader.readAsDataURL(file)
    }
  }
}

async function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (!e.dataTransfer?.files) return

  let visionBlocked = false

  for (const file of e.dataTransfer.files) {
    const isImage = file.type.startsWith('image/')
    if (isImage && !supportsVision.value) { visionBlocked = true; continue }

    // Files dragged from Finder carry a filesystem path; files dragged
    // from other apps (Mail, Preview, browsers) don't. Persist those to
    // a temp file so the agent can read them by path.
    const tauriPath = (file as File & { path?: string }).path
    if (tauriPath) {
      attachments.value.push({ type: 'file', name: file.name, path: tauriPath, size: file.size })
      continue
    }

    const persisted = await persistBlobToTmp(file).catch(() => null)
    if (persisted) {
      attachments.value.push({ type: 'file', name: persisted.name, path: persisted.path, size: file.size })
      continue
    }

    // Browser fallback: inline image as a data URL.
    if (isImage) {
      const reader = new FileReader()
      reader.onload = () => {
        attachments.value.push({ type: 'image', src: reader.result as string, alt: file.name })
      }
      reader.readAsDataURL(file)
    }
  }

  if (visionBlocked) {
    useNotification().add({ title: 'Image skipped', description: 'The current model does not support images. Switch to a vision-capable model to attach pictures.' })
  }
}

async function handleFileSelect(e: Event) {
  const htmlInput = e.target as HTMLInputElement
  htmlInput.value = ''

  try {
    const { isTauriEnv } = await import('@/utils/tauri')
    if (isTauriEnv()) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'All Supported', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'md', 'txt', 'json', 'csv', 'ts', 'js', 'go', 'rs', 'py', 'vue', 'html', 'css', 'yaml', 'yml', 'toml'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
          { name: 'Documents', extensions: ['pdf', 'md', 'txt', 'csv', 'json'] },
        ],
      })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      for (const filePath of paths) {
        const name = filePath.split('/').pop() || filePath
        attachments.value.push({ type: 'file', name, path: filePath })
      }
      return
    }
  } catch { /* not in Tauri */ }

  const files = htmlInput.files
  if (!files) return
  for (const file of files) {
    attachments.value.push({ type: 'file', name: file.name, size: file.size })
  }
}

async function openFilePicker() {
  try {
    const { isTauriEnv } = await import('@/utils/tauri')
    if (isTauriEnv()) {
      const fakeEvent = { target: { value: '' } } as unknown as Event
      await handleFileSelect(fakeEvent)
      return
    }
  } catch { /* fallback */ }
  const el = document.querySelector('input[type="file"]') as HTMLInputElement
  el?.click()
}

function isImageFile(name: string): boolean {
  if (!name) return false
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
}

function getAttachmentSrc(att: RequestBlock): string {
  if (att.type === 'image') return (att as ImageBlock).src
  if (att.type === 'file') {
    const withPath = att as RequestBlock & { path?: string }
    if (withPath.path) return toAssetUrl(withPath.path)
  }
  return ''
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
    :class="[isDragOver ? 'dock-input--dragover' : '', variant === 'editorial' ? 'dock-input--editorial' : '']"
    @dragover.prevent="isDragOver = true"
    @dragleave="isDragOver = false"
    @drop="handleDrop"
  >
    <!-- Attachment previews -->
    <div v-if="attachments.length" class="flex flex-wrap gap-2 px-4 pt-3 pb-1">
      <div v-for="(att, i) in attachments" :key="i" class="relative group">
        <img
          v-if="att.type === 'image' || (att.type === 'file' && isImageFile((att as any).name))"
          :src="getAttachmentSrc(att)"
          class="size-12 rounded-lg object-cover border border-white/20 dark:border-white/10"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
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
        >
×
</button>
      </div>
    </div>

    <!-- Input row -->
    <div class="flex items-center gap-1.5 px-2 py-2">
      <!-- + button (left) — upload/attach -->
      <button
        class="dock-btn"
        @click="openFilePicker"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        multiple
        :accept="acceptTypes"
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
        @paste="handlePaste"
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
    </div>

    <!-- Drop hint -->
    <div v-if="isDragOver" class="pb-2 text-center text-xs text-app-accent font-medium">
      {{ supportsVision ? 'Drop images or files here' : 'Drop files here' }}
    </div>

    <!-- Vision indicator -->
    <div v-if="supportsVision && !isDragOver && !attachments.length" class="pb-1.5 px-4">
      <span
        class="text-[var(--app-muted)]/40"
        :class="variant === 'editorial' ? 'text-[9px] uppercase tracking-[0.18em] font-semibold' : 'text-[9px]'"
      >
        {{ variant === 'editorial' ? 'Vision enabled · paste, drop or attach' : 'This model supports images — paste, drop, or attach' }}
      </span>
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

/* ── Editorial variant ──────────────────────────────────────────────
   Clean, solid, brand-accent look matching the Construct landing page.
   No glass/blur: a crisp white card in light, solid slate in dark, with
   a filled accent send button like the "Download Free" CTA. */
.dock-input--editorial {
  border-radius: 0.875rem;
  border: 1px solid rgba(0, 0, 0, 0.10);
  background: #ffffff;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 10px 28px -16px rgba(0, 0, 0, 0.18);
}
:root.dark .dock-input--editorial,
.dark .dock-input--editorial {
  border-color: rgba(255, 255, 255, 0.10);
  background: #14161b;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 10px 28px -16px rgba(0, 0, 0, 0.7);
}

.dock-input--editorial:focus-within {
  border-color: var(--app-accent);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 0 0 3px color-mix(in srgb, var(--app-accent) 14%, transparent);
}
:root.dark .dock-input--editorial:focus-within,
.dark .dock-input--editorial:focus-within {
  border-color: var(--app-accent);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 0 0 3px color-mix(in srgb, var(--app-accent) 18%, transparent);
}

.dock-input--editorial.dock-input--dragover {
  border-color: var(--app-accent);
  background: color-mix(in srgb, var(--app-accent) 6%, #ffffff);
}
:root.dark .dock-input--editorial.dock-input--dragover,
.dark .dock-input--editorial.dock-input--dragover {
  background: color-mix(in srgb, var(--app-accent) 12%, #14161b);
}

/* Solid filled send button — the landing-page CTA, not a tinted ghost. */
.dock-input--editorial .dock-btn--send {
  color: #fff;
  background: var(--app-accent);
  border-radius: 0.5rem;
}
.dock-input--editorial .dock-btn--send:hover {
  color: #fff;
  background: color-mix(in srgb, var(--app-accent) 88%, #000);
}
.dock-input--editorial .dock-btn--send:disabled {
  opacity: 0.35;
}
</style>
