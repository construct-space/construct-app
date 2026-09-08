<script setup lang="ts">
/**
 * RequestBubble — Renders request blocks (what the user sent)
 * Right-aligned bubble with text, image thumbnails, file chips.
 */
import { ref } from 'vue'
import type { RequestBlock, ImageBlock, FileBlock } from '@/assistant'

defineProps<{
  blocks: RequestBlock[]
}>()

// Lazy-load convertFileSrc for Tauri file path → webview URL conversion
const convertFileSrc = ref<((path: string) => string) | null>(null)
import('@tauri-apps/api/core').then(m => { convertFileSrc.value = m.convertFileSrc }).catch(() => {})

function isImageFile(name: string): boolean {
  if (!name) return false
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
}
</script>

<template>
  <div class="flex justify-end">
    <div class="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-app-accent text-app-accent-foreground">
      <template v-for="(block, i) in blocks" :key="i">
        <!-- Text -->
        <div v-if="block.type === 'text'" class="text-sm leading-relaxed">
          {{ block.content }}
        </div>

        <!-- Image thumbnail -->
        <div v-else-if="block.type === 'image'" class="mt-2">
          <img
            :src="(block as ImageBlock).src"
            :alt="(block as ImageBlock).alt || 'Attached image'"
            class="max-w-48 max-h-32 rounded-lg object-cover"
          />
        </div>

        <!-- File block: image preview or file chip -->
        <template v-else-if="block.type === 'file'">
          <div v-if="isImageFile((block as FileBlock).name) && (block as FileBlock).path" class="mt-2">
            <img
              :src="convertFileSrc ? convertFileSrc((block as FileBlock).path!) : ''"
              :alt="(block as FileBlock).name"
              class="max-w-xs max-h-48 rounded-lg object-cover"
              @error="($event.target as HTMLImageElement).classList.add('hidden')"
            />
          </div>
          <div v-else class="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-white/20 rounded-md text-xs">
            <svg class="size-3" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a2 2 0 01-2 2H4a2 2 0 01-2-2V2a2 2 0 012-2h5.5L14 4.5zM9.5 1v3.5H13" /></svg>
            {{ (block as FileBlock).name }}
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
