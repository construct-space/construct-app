<script setup lang="ts">
/**
 * VideoEmbed — Renders detected video URLs as inline embed cards.
 *
 * Supported: YouTube, Vimeo. Shows thumbnail + play overlay. Click opens
 * in Construct browser (or external browser fallback).
 */
import { computed } from 'vue'
import { Play } from 'lucide-vue-next'
import { isTauriEnv } from '@/utils/tauri'

const props = defineProps<{
  content: string
}>()

interface VideoCard {
  url: string
  thumbnailUrl: string
  title: string
  provider: string
}

const YOUTUBE_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})(?:[^\s)]*)?/g
const VIMEO_RE = /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d{6,11})(?:[^\s)]*)?/g

const videos = computed<VideoCard[]>(() => {
  if (!props.content) return []
  const found: VideoCard[] = []
  const seen = new Set<string>()

  // YouTube
  for (const m of props.content.matchAll(YOUTUBE_RE)) {
    const id = m[1]
    if (seen.has(`yt-${id}`)) continue
    seen.add(`yt-${id}`)
    found.push({
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      title: 'YouTube',
      provider: 'youtube',
    })
  }

  // Vimeo
  for (const m of props.content.matchAll(VIMEO_RE)) {
    const id = m[1]
    if (seen.has(`vim-${id}`)) continue
    seen.add(`vim-${id}`)
    found.push({
      url: `https://vimeo.com/${id}`,
      thumbnailUrl: `https://vumbnail.com/${id}.jpg`,
      title: 'Vimeo',
      provider: 'vimeo',
    })
  }

  return found.slice(0, 4)
})

async function openVideo(url: string) {
  if (isTauriEnv()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('browser_open_host', { mode: 'browser', url, title: 'Video' })
      return
    } catch { /* fallback */ }
  }
  window.open(url, '_blank')
}
</script>

<template>
  <div v-if="videos.length" class="flex flex-wrap gap-2 my-2">
    <button
      v-for="v in videos" :key="v.url"
      class="group relative rounded-lg overflow-hidden border border-app-border hover:border-app-accent/40 transition w-[280px]"
      @click="openVideo(v.url)"
    >
      <img
        :src="v.thumbnailUrl"
        :alt="v.title"
        class="w-full h-[158px] object-cover bg-black"
        loading="lazy"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <!-- Play overlay -->
      <div class="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition">
        <div class="size-12 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
          <Play class="size-5 text-white fill-white ml-0.5" />
        </div>
      </div>
      <!-- Provider badge -->
      <span class="absolute top-2 right-2 px-1.5 py-0.5 text-[9px] font-medium rounded bg-black/60 text-white/80 uppercase">
        {{ v.provider }}
      </span>
    </button>
  </div>
</template>
