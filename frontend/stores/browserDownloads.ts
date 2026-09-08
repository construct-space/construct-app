import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Download {
  id: string
  filename: string
  url: string
  filepath: string
  status: 'downloading' | 'completed' | 'failed' | 'paused'
  progress: number // 0-100
  size: number
  downloadedSize: number
  startedAt: number
  completedAt: number | null
}

export const useBrowserDownloadsStore = defineStore('browserDownloads', () => {
  const downloads = ref<Download[]>([])

  const add = (download: Omit<Download, 'id'>) => {
    const newDownload: Download = {
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...download,
    }
    downloads.value.unshift(newDownload)
    return newDownload.id
  }

  const update = (id: string, updates: Partial<Download>) => {
    const download = downloads.value.find(d => d.id === id)
    if (download) {
      Object.assign(download, updates)
    }
  }

  const remove = (id: string) => {
    downloads.value = downloads.value.filter(d => d.id !== id)
  }

  const clear = () => {
    downloads.value = downloads.value.filter(d => d.status !== 'completed')
  }

  return {
    downloads: computed(() => downloads.value),
    add,
    update,
    remove,
    clear,
  }
})
