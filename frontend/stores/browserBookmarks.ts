import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Bookmark {
  id: string
  title: string
  url: string
  favicon: string | null
  folderId: string | null // null = root level
  createdAt: number
}

export interface BookmarkFolder {
  id: string
  title: string
  folderId: string | null // parent folder
  createdAt: number
}

export const useBrowserBookmarksStore = defineStore('browserBookmarks', () => {
  const bookmarks = ref<Bookmark[]>([])
  const folders = ref<BookmarkFolder[]>([])

  // Built-in folders
  const initFolders = () => {
    if (folders.value.length === 0) {
      folders.value = [
        { id: 'favorites', title: 'Favorites', folderId: null, createdAt: Date.now() },
      ]
    }
  }

  const addBookmark = (bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => {
    // Check if already exists
    const existing = bookmarks.value.find(b => b.url === bookmark.url)
    if (existing) return existing.id

    const newBookmark: Bookmark = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...bookmark,
      createdAt: Date.now(),
    }
    bookmarks.value.unshift(newBookmark)
    return newBookmark.id
  }

  const removeBookmark = (id: string) => {
    bookmarks.value = bookmarks.value.filter(b => b.id !== id)
  }

  const isBookmarked = (url: string) => {
    return bookmarks.value.some(b => b.url === url)
  }

  const getBookmarksByFolder = (folderId: string | null = null) => {
    return bookmarks.value.filter(b => b.folderId === folderId)
  }

  const addFolder = (folder: Omit<BookmarkFolder, 'id' | 'createdAt'>) => {
    const newFolder: BookmarkFolder = {
      id: `fold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...folder,
      createdAt: Date.now(),
    }
    folders.value.push(newFolder)
    return newFolder.id
  }

  const removeFolder = (id: string) => {
    folders.value = folders.value.filter(f => f.id !== id)
    bookmarks.value = bookmarks.value.filter(b => b.folderId !== id)
  }

  return {
    bookmarks: computed(() => bookmarks.value),
    folders: computed(() => folders.value),
    initFolders,
    addBookmark,
    removeBookmark,
    isBookmarked,
    getBookmarksByFolder,
    addFolder,
    removeFolder,
  }
})
