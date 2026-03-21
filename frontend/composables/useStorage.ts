/**
 * Unified Storage Composable
 * Replaces localStorage and IndexedDB with SQLite via context service
 *
 * Provides a consistent async API for storage operations that works
 * through the Go backend when running in Tauri, with fallback to
 * localStorage when not in Tauri.
 */

import { ref, watch, type Ref } from 'vue'
import { useOperator } from '@/operator'
import type { ProjectLocalSettings } from '~/utils/db'
import type { PinnedItem } from '~/stores/pinned'

// ============================================
// Types
// ============================================

export interface StorageOptions {
  category?: string
  projectId?: number
  userId?: string
}

export interface StorageItem {
  key: string
  value: unknown
  category?: string
  projectId?: number
  userId?: string
  createdAt?: string
  updatedAt?: string
}

export interface UseStorageReturn {
  // Simple key-value (localStorage replacement)
  get: <T = unknown>(key: string, options?: StorageOptions) => Promise<T | null>
  set: (key: string, value: unknown, options?: StorageOptions) => Promise<void>
  remove: (key: string, options?: StorageOptions) => Promise<void>

  // Batch operations
  getMany: <T = unknown>(keys: string[], options?: StorageOptions) => Promise<Record<string, T>>
  setMany: (items: Record<string, unknown>, options?: StorageOptions) => Promise<void>

  // List by category
  list: (options?: StorageOptions) => Promise<Array<{ key: string; value: unknown }>>

  // Reactive storage (returns a ref that syncs)
  reactive: <T>(key: string, defaultValue: T, options?: StorageOptions) => Ref<T>

  // Project settings
  projectSettings: {
    get: (projectId: number) => Promise<ProjectLocalSettings | null>
    set: (projectId: number, settings: Partial<ProjectLocalSettings>) => Promise<void>
  }

  // Pinned items
  pinned: {
    list: () => Promise<PinnedItem[]>
    add: (item: PinnedItem) => Promise<void>
    remove: (id: string) => Promise<void>
    reorder: (items: Array<{ id: string; sortOrder: number }>) => Promise<void>
  }

  // Check if storage is available
  isAvailable: Ref<boolean>
}

// ============================================
// Helper Functions
// ============================================

// Check if running in Tauri
function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && (
    '__TAURI__' in window ||
    '__TAURI_INTERNALS__' in window ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost'
  )
}

// Cache for reactive refs to avoid duplicates
const reactiveCache = new Map<string, Ref<unknown>>()

// Generate cache key for reactive refs
function getReactiveCacheKey(key: string, options?: StorageOptions): string {
  const parts = [key]
  if (options?.category) parts.push(`cat:${options.category}`)
  if (options?.projectId) parts.push(`proj:${options.projectId}`)
  if (options?.userId) parts.push(`user:${options.userId}`)
  return parts.join('|')
}

// Note: generateLocalId is available from ~/utils/db

// ============================================
// Main Composable
// ============================================

export function useStorage(): UseStorageReturn {
  const { send, isTauri } = useOperator()
  const isAvailable = ref(false)

  // Initialize availability check
  if (typeof window !== 'undefined') {
    isAvailable.value = isTauriEnvironment()
  }

  // ============================================
  // Simple Key-Value Operations
  // ============================================

  async function get<T = unknown>(key: string, options?: StorageOptions): Promise<T | null> {
    if (!isTauri.value) {
      // Fallback to localStorage
      try {
        const storageKey = buildStorageKey(key, options)
        const value = localStorage.getItem(storageKey)
        return value ? JSON.parse(value) : null
      } catch (error) {
        console.error('[useStorage] localStorage get error:', error)
        return null
      }
    }

    try {
      const result = await send<{ value: T | null }>('storage.get', {
        key,
        category: options?.category,
        projectId: options?.projectId,
        userId: options?.userId
      })
      return result?.value ?? null
    } catch (error) {
      console.error('[useStorage] get error:', error)
      return null
    }
  }

  async function set(key: string, value: unknown, options?: StorageOptions): Promise<void> {
    if (!isTauri.value) {
      // Fallback to localStorage
      try {
        const storageKey = buildStorageKey(key, options)
        localStorage.setItem(storageKey, JSON.stringify(value))
        return
      } catch (error) {
        console.error('[useStorage] localStorage set error:', error)
        return
      }
    }

    try {
      await send('storage.set', {
        key,
        value,
        category: options?.category,
        projectId: options?.projectId,
        userId: options?.userId
      })
    } catch (error) {
      console.error('[useStorage] set error:', error)
    }
  }

  async function remove(key: string, options?: StorageOptions): Promise<void> {
    if (!isTauri.value) {
      // Fallback to localStorage
      try {
        const storageKey = buildStorageKey(key, options)
        localStorage.removeItem(storageKey)
        return
      } catch (error) {
        console.error('[useStorage] localStorage remove error:', error)
        return
      }
    }

    try {
      await send('storage.delete', {
        key
      })
    } catch (error) {
      console.error('[useStorage] remove error:', error)
    }
  }

  // ============================================
  // Batch Operations
  // ============================================

  async function getMany<T = unknown>(keys: string[], options?: StorageOptions): Promise<Record<string, T>> {
    if (!isTauri.value) {
      // Fallback to localStorage
      const result: Record<string, T> = {}
      for (const key of keys) {
        const value = await get<T>(key, options)
        if (value !== null) {
          result[key] = value
        }
      }
      return result
    }

    try {
      const result = await send<{ items: Record<string, T> }>('storage.batch_get', {
        keys
      })
      return result?.items ?? {}
    } catch (error) {
      console.error('[useStorage] getMany error:', error)
      return {}
    }
  }

  async function setMany(items: Record<string, unknown>, options?: StorageOptions): Promise<void> {
    if (!isTauri.value) {
      // Fallback to localStorage
      for (const [key, value] of Object.entries(items)) {
        await set(key, value, options)
      }
      return
    }

    try {
      await send('storage.batch_set', {
        items,
        category: options?.category
      })
    } catch (error) {
      console.error('[useStorage] setMany error:', error)
    }
  }

  // ============================================
  // List Operations
  // ============================================

  async function list(options?: StorageOptions): Promise<Array<{ key: string; value: unknown }>> {
    if (!isTauri.value) {
      // Fallback: scan localStorage for matching keys
      const result: Array<{ key: string; value: unknown }> = []
      const prefix = buildStorageKey('', options)

      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i)
        if (storageKey && storageKey.startsWith(prefix)) {
          try {
            const rawKey = storageKey.slice(prefix.length)
            const value = JSON.parse(localStorage.getItem(storageKey) || 'null')
            result.push({ key: rawKey, value })
          } catch {
            // Skip invalid entries
          }
        }
      }
      return result
    }

    try {
      const result = await send<{ items: Array<{ key: string; value: unknown }> }>('storage.list', {
        category: options?.category,
        projectId: options?.projectId,
        userId: options?.userId
      })
      return result?.items ?? []
    } catch (error) {
      console.error('[useStorage] list error:', error)
      return []
    }
  }

  // ============================================
  // Reactive Storage
  // ============================================

  function reactive<T>(key: string, defaultValue: T, options?: StorageOptions): Ref<T> {
    const cacheKey = getReactiveCacheKey(key, options)

    // Return cached ref if exists
    if (reactiveCache.has(cacheKey)) {
      return reactiveCache.get(cacheKey) as Ref<T>
    }

    // Create new reactive ref
    const valueRef = ref<T>(defaultValue) as Ref<T>
    let isUpdating = false

    // Load initial value
    get<T>(key, options).then((value) => {
      if (value !== null) {
        isUpdating = true
        valueRef.value = value
        isUpdating = false
      }
    })

    // Watch for changes and sync to storage
    watch(valueRef, async (newValue) => {
      if (isUpdating) return
      await set(key, newValue, options)
    }, { deep: true })

    // Cache the ref
    reactiveCache.set(cacheKey, valueRef)

    return valueRef
  }

  // ============================================
  // Project Settings
  // ============================================

  const projectSettings = {
    async get(projectId: number): Promise<ProjectLocalSettings | null> {
      if (!isTauri.value) {
        const value = await get<ProjectLocalSettings>(`project_${projectId}`, { category: 'project_settings' })
        return value
      }

      try {
        const result = await send<ProjectLocalSettings | null>('project_settings.get', {
          projectId
        })
        return result ?? null
      } catch (error) {
        console.error('[useStorage] projectSettings.get error:', error)
        return null
      }
    },

    async set(projectId: number, settings: Partial<ProjectLocalSettings>): Promise<void> {
      const fullSettings: ProjectLocalSettings = {
        projectId,
        ...settings,
        updatedAt: new Date()
      }

      if (!isTauri.value) {
        await set(`project_${projectId}`, fullSettings, { category: 'project_settings' })
        return
      }

      try {
        await send('project_settings.set', {
          projectId,
          localPath: fullSettings.localPath
        })
      } catch (error) {
        console.error('[useStorage] projectSettings.set error:', error)
      }
    }
  }

  // ============================================
  // Pinned Items
  // ============================================

  const pinned = {
    async list(): Promise<PinnedItem[]> {
      if (!isTauri.value) {
        const items = await list({ category: 'pinned' })
        return items
          .map(item => item.value as PinnedItem)
          .sort((a, b) => {
            if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
              return a.sortOrder - b.sortOrder
            }
            return new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime()
          })
      }

      try {
        const result = await send<{ items: PinnedItem[] }>('pinned.list', {})
        return result?.items ?? []
      } catch (error) {
        console.error('[useStorage] pinned.list error:', error)
        return []
      }
    },

    async add(item: PinnedItem): Promise<void> {
      const pinnedItem: PinnedItem = {
        ...item,
        pinnedAt: item.pinnedAt || new Date().toISOString()
      }

      if (!isTauri.value) {
        await set(`pinned_${item.id}`, pinnedItem, { category: 'pinned' })
        return
      }

      try {
        await send('pinned.add', pinnedItem as unknown as Record<string, unknown>)
      } catch (error) {
        console.error('[useStorage] pinned.add error:', error)
      }
    },

    async remove(id: string): Promise<void> {
      if (!isTauri.value) {
        await remove(`pinned_${id}`, { category: 'pinned' })
        return
      }

      try {
        await send('pinned.remove', { id })
      } catch (error) {
        console.error('[useStorage] pinned.remove error:', error)
      }
    },

    async reorder(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
      if (!isTauri.value) {
        // Fallback: update each item's sortOrder
        for (const { id, sortOrder } of items) {
          const existing = await get<PinnedItem>(`pinned_${id}`, { category: 'pinned' })
          if (existing) {
            await set(`pinned_${id}`, { ...existing, sortOrder }, { category: 'pinned' })
          }
        }
        return
      }

      try {
        await send('pinned.reorder', { items })
      } catch (error) {
        console.error('[useStorage] pinned.reorder error:', error)
      }
    }
  }

  return {
    get,
    set,
    remove,
    getMany,
    setMany,
    list,
    reactive,
    projectSettings,
    pinned,
    isAvailable
  }
}

// ============================================
// Helper Functions
// ============================================

function buildStorageKey(key: string, options?: StorageOptions): string {
  const parts = ['construct']
  if (options?.category) parts.push(options.category)
  if (options?.projectId) parts.push(`p${options.projectId}`)
  if (options?.userId) parts.push(`u${options.userId}`)
  parts.push(key)
  return parts.join(':')
}

// ============================================
// Migration Helper
// ============================================

/**
 * Helper for migrating data from localStorage to the unified storage
 *
 * @param key - The localStorage key to migrate
 * @param category - Optional category for the new storage
 * @returns Promise that resolves when migration is complete
 */
export async function migrateFromLocalStorage(key: string, category?: string): Promise<void> {
  if (typeof window === 'undefined') return

  const storage = useStorage()

  // Check if already running in Tauri
  if (!storage.isAvailable.value) {
    console.log('[migrateFromLocalStorage] Not in Tauri, skipping migration')
    return
  }

  try {
    // Get value from localStorage
    const rawValue = localStorage.getItem(key)
    if (!rawValue) {
      console.log('[migrateFromLocalStorage] No value found for key:', key)
      return
    }

    // Parse the value
    let value: unknown
    try {
      value = JSON.parse(rawValue)
    } catch {
      value = rawValue
    }

    // Store in new storage
    await storage.set(key, value, { category })

    // Remove from localStorage after successful migration
    localStorage.removeItem(key)

    console.log('[migrateFromLocalStorage] Successfully migrated key:', key)
  } catch (error) {
    console.error('[migrateFromLocalStorage] Failed to migrate key:', key, error)
  }
}

/**
 * Migrate all pinned items from localStorage to unified storage
 */
export async function migratePinnedItems(): Promise<void> {
  if (typeof window === 'undefined') return

  const LEGACY_KEY = 'cp_pinned_items'
  const storage = useStorage()

  if (!storage.isAvailable.value) return

  try {
    const rawValue = localStorage.getItem(LEGACY_KEY)
    if (!rawValue) return

    const items: PinnedItem[] = JSON.parse(rawValue)

    for (const item of items) {
      await storage.pinned.add(item)
    }

    localStorage.removeItem(LEGACY_KEY)
    console.log('[migratePinnedItems] Migrated', items.length, 'pinned items')
  } catch (error) {
    console.error('[migratePinnedItems] Migration failed:', error)
  }
}
