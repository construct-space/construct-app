import { defineStore } from 'pinia'
import { computed, shallowRef, triggerRef } from 'vue'

export interface HistoryEntry {
  id: string
  url: string
  title: string
  favicon: string | null
  visitedAt: number // timestamp
  visitCount: number
}

export const useBrowserHistoryStore = defineStore('browserHistory', () => {
  const MAX_ENTRIES = 5000
  const entries = shallowRef<HistoryEntry[]>([])

  const add = (entry: Omit<HistoryEntry, 'id' | 'visitedAt' | 'visitCount'>) => {
    const list = entries.value
    // Check if already exists
    const existingIndex = list.findIndex(e => e.url === entry.url)
    if (existingIndex >= 0) {
      const existing = list[existingIndex]!
      existing.visitCount += 1
      existing.visitedAt = Date.now()
      existing.title = entry.title
      existing.favicon = entry.favicon
      // Move to front (most recent)
      list.splice(existingIndex, 1)
      list.unshift(existing)
    } else {
      const newEntry: HistoryEntry = {
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...entry,
        visitedAt: Date.now(),
        visitCount: 1,
      }
      list.unshift(newEntry)
    }
    // Cap at MAX_ENTRIES
    if (list.length > MAX_ENTRIES) {
      list.length = MAX_ENTRIES
    }
    triggerRef(entries)
  }

  const search = (query: string) => {
    const q = query.toLowerCase()
    return entries.value.filter(
      e => e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q)
    )
  }

  const getRecent = (limit: number = 20) => {
    return entries.value.slice(0, limit)
  }

  const clear = () => {
    entries.value = []
  }

  const remove = (id: string) => {
    entries.value = entries.value.filter(e => e.id !== id)
  }

  return {
    entries: computed(() => entries.value),
    add,
    search,
    getRecent,
    clear,
    remove,
  }
})
