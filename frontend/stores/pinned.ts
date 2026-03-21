/**
 * Pinned Items Store
 *
 * Manages pinned shortcuts for quick access from the home page dock.
 * Uses SQLite (context.db) for Tauri, localStorage fallback for web.
 */

const STORAGE_KEY = 'cp_pinned_items'
const isContextNotConnectedError = (error: unknown): boolean =>
  String(error).toLowerCase().includes('not connected')

export interface PinnedItem {
  id: string
  type: 'project' | 'folder' | 'page' | 'space' | 'link' | 'task'
  name: string
  icon: string
  path: string
  color?: string
  metadata?: {
    projectId?: string | number
    localPath?: string
    spaceId?: string
    taskId?: number
    description?: string
    priority?: string
    status?: string
  }
  pinnedAt: string
  sortOrder?: number
}

export const usePinnedStore = defineStore('pinned', {
  state: () => ({
    items: [] as PinnedItem[]
  }),

  getters: {
    // Get all pinned items sorted by sortOrder then pinnedAt
    pinnedItems: (state): PinnedItem[] => {
      return [...state.items].sort((a, b) => {
        // Sort by sortOrder first, then by pinnedAt (newest first)
        if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
          return a.sortOrder - b.sortOrder
        }
        return new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime()
      })
    },

    // Check if an item is pinned by ID
    isPinned: (state) => (id: string): boolean => {
      return state.items.some(item => item.id === id)
    },

    // Get pinned items by type
    pinnedByType: (state) => (type: PinnedItem['type']): PinnedItem[] => {
      return state.items
        .filter(item => item.type === type)
        .sort((a, b) => new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime())
    },

    // Get count of pinned items
    pinnedCount: (state): number => state.items.length
  },

  actions: {
    // Initialize store - load from SQLite (Tauri) or localStorage (web)
    async init() {
      if (typeof window === 'undefined') return

      const db = useContextDB()

      // Disposal flag and timeout handle to stop retrying when the store is no longer needed
      let disposed = false
      let retryTimeout: ReturnType<typeof setTimeout> | null = null
      const scope = getCurrentScope()
      if (scope) {
        onScopeDispose(() => {
          disposed = true
          if (retryTimeout !== null) {
            clearTimeout(retryTimeout)
            retryTimeout = null
          }
        })
      }

      const MAX_RETRIES = 5
      const retryLoadFromSQLite = async (attempt = 1): Promise<void> => {
        if (attempt > MAX_RETRIES || disposed) return
        // Exponential backoff: 500ms, 1000ms, 2000ms, 4000ms, 8000ms (capped at 5s)
        const delay = Math.min(500 * Math.pow(2, attempt - 1), 5000)
        await new Promise<void>(resolve => {
          retryTimeout = setTimeout(() => {
            retryTimeout = null
            resolve()
          }, delay)
        })
        if (disposed) return
        const items = await db.pinnedList()
        // Once connected, trust SQLite result (including empty) and stop retrying.
        if (db.connected.value) {
          if (!disposed) this.items = items
          return
        }
        // Context service still not ready; keep retrying.
        await retryLoadFromSQLite(attempt + 1)
      }

      if (db.isTauri.value) {
        try {
          // Load from SQLite via context.db
          const items = await db.pinnedList()
          this.items = items

          // Startup race: context service may still be booting. Retry in background
          // so existing pinned items reappear once connection is ready.
          if (!db.connected.value) {
            void retryLoadFromSQLite()
          }

          // Check if we need to migrate from localStorage
          const stored = localStorage.getItem(STORAGE_KEY)
          if (stored && this.items.length === 0) {
            try {
              const localItems = JSON.parse(stored) as PinnedItem[]
              if (localItems.length > 0) {
                // Migrate each item to SQLite
                for (const item of localItems) {
                  await db.pinnedAdd(item)
                }
                this.items = localItems
                // Clear localStorage after successful migration
                localStorage.removeItem(STORAGE_KEY)
              }
            } catch (e) {
              console.error('[PinnedStore] Migration failed:', e)
            }
          }
        } catch (error) {
          if (!isContextNotConnectedError(error)) {
            console.warn('[PinnedStore] Failed to load from SQLite:', error)
          }
          // Fallback to localStorage if SQLite fails
          const stored = localStorage.getItem(STORAGE_KEY)
          if (stored) {
            try {
              this.items = JSON.parse(stored)
            } catch {
              this.items = []
            }
          }
          if (isContextNotConnectedError(error)) {
            void retryLoadFromSQLite()
          }
        }
      } else {
        // Fallback for web
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
          try {
            this.items = JSON.parse(stored)
          } catch (e) {
            console.error('[PinnedStore] Failed to parse stored items:', e)
            this.items = []
          }
        }
      }
    },

    // Add a new pinned item (optimistic: updates local state immediately)
    async addPin(item: Omit<PinnedItem, 'pinnedAt'>) {
      // Check if already pinned
      if (this.isPinned(item.id)) {
        return false
      }

      const pinnedItem: PinnedItem = {
        ...item,
        pinnedAt: new Date().toISOString(),
        sortOrder: this.items.length
      }

      // Optimistic: update local state immediately
      this.items.push(pinnedItem)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items))

      const db = useContextDB()

      if (db.isTauri.value) {
        try {
          await db.pinnedAdd(pinnedItem)
        } catch (error) {
          if (!isContextNotConnectedError(error)) {
            console.warn('[PinnedStore] Failed to persist pin to SQLite:', error)
          }
          // Pin still persisted in localStorage as fallback
        }
      }

      return true
    },

    // Remove a pinned item by ID (optimistic: updates local state immediately)
    async removePin(id: string) {
      const index = this.items.findIndex(item => item.id === id)
      if (index === -1) return false

      // Optimistic: update local state immediately
      this.items.splice(index, 1)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items))

      const db = useContextDB()

      if (db.isTauri.value) {
        try {
          await db.pinnedRemove(id)
        } catch (error) {
          if (!isContextNotConnectedError(error)) {
            console.warn('[PinnedStore] Failed to remove pin from SQLite:', error)
          }
          // Local state already updated; localStorage has the fallback
        }
      }

      return true
    },

    // Toggle pin state (add if not pinned, remove if pinned)
    async togglePin(item: Omit<PinnedItem, 'pinnedAt'>): Promise<boolean> {
      if (this.isPinned(item.id)) {
        await this.removePin(item.id)
        return false // Now unpinned
      } else {
        await this.addPin(item)
        return true // Now pinned
      }
    },

    // Update an existing pinned item
    async updatePin(id: string, updates: Partial<Omit<PinnedItem, 'id' | 'pinnedAt'>>) {
      const item = this.items.find(item => item.id === id)
      if (!item) return false

      Object.assign(item, updates)

      const db = useContextDB()

      if (db.isTauri.value) {
        return await db.pinnedAdd({ ...item }) // Upsert
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items))
        return true
      }
    },

    // Reorder pinned items
    async reorder(orderedIds: string[]) {
      // Update local sortOrder
      orderedIds.forEach((id, index) => {
        const item = this.items.find(i => i.id === id)
        if (item) item.sortOrder = index
      })

      const db = useContextDB()

      if (db.isTauri.value) {
        await db.pinnedReorder(orderedIds)
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items))
      }
    },

    // Clear all pinned items (localStorage only, SQLite requires individual removes)
    async clearAll() {
      const db = useContextDB()

      if (db.isTauri.value) {
        // Remove each item from SQLite
        for (const item of this.items) {
          await db.pinnedRemove(item.id)
        }
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
      }

      this.items = []
    },

    // Get a pinned item by ID
    getPin(id: string): PinnedItem | undefined {
      return this.items.find(item => item.id === id)
    }
  }
})

// Helper functions to create pinned item objects
export const createProjectPin = (project: { id: number | string; name: string; description?: string; path?: string }): Omit<PinnedItem, 'pinnedAt'> => ({
  id: `project-${project.id}`,
  type: 'project',
  name: project.name,
  icon: 'i-lucide-folder',
  path: `/app/projects/${project.id}/code`,
  metadata: {
    projectId: project.id,
    description: project.description
  }
})

export const createFolderPin = (folder: { name: string; localPath: string; projectId?: number | string }): Omit<PinnedItem, 'pinnedAt'> => ({
  id: `folder-${folder.localPath}`,
  type: 'folder',
  name: folder.name,
  icon: 'i-lucide-folder-code',
  path: `/app/code/editor?project=${encodeURIComponent(folder.localPath)}`,
  metadata: {
    localPath: folder.localPath,
    projectId: folder.projectId
  }
})

export const createPagePin = (page: { name: string; path: string; icon?: string }): Omit<PinnedItem, 'pinnedAt'> => ({
  id: `page-${page.path}`,
  type: 'page',
  name: page.name,
  icon: page.icon || 'i-lucide-file',
  path: page.path
})

export const createSpacePin = (space: { name: string; spaceId: string; projectId?: number | string; projectPath?: string; icon?: string }): Omit<PinnedItem, 'pinnedAt'> => ({
  id: `space-${space.projectId || 'global'}-${space.spaceId}`,
  type: 'space',
  name: space.name,
  icon: space.icon || 'i-lucide-layout-grid',
  path: space.projectId
    ? `/app/projects/${space.projectId}/${space.spaceId}`
    : `/app/${space.spaceId}`,
  metadata: {
    spaceId: space.spaceId,
    projectId: space.projectId
  }
})

export const createLinkPin = (link: { name: string; url: string; icon?: string }): Omit<PinnedItem, 'pinnedAt'> => ({
  id: `link-${link.url}`,
  type: 'link',
  name: link.name,
  icon: link.icon || 'i-lucide-external-link',
  path: link.url
})

export const createTaskPin = (task: { id: number; title: string; projectId?: number | string; projectPath?: string; priority?: string; status?: string; description?: string }): Omit<PinnedItem, 'pinnedAt'> => ({
  id: `task-${task.projectId || 'global'}-${task.id}`,
  type: 'task',
  name: task.title,
  icon: task.priority === 'high' ? 'i-lucide-alert-circle' : task.priority === 'medium' ? 'i-lucide-circle-dot' : 'i-lucide-circle',
  path: task.projectId
    ? `/app/projects/${task.projectId}/kanban?task=${task.id}`
    : `/app/kanban?task=${task.id}`,
  color: task.priority === 'high' ? 'red' : task.priority === 'medium' ? 'yellow' : undefined,
  metadata: {
    projectId: task.projectId,
    taskId: task.id,
    priority: task.priority,
    status: task.status,
    description: task.description
  }
})
