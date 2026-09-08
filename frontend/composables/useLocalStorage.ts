/**
 * Unified Storage Composable
 * Replaces localStorage and IndexedDB with SQLite via context service
 *
 * Provides a consistent async API for storage operations that works
 * through the Go backend when running in Tauri, with fallback to
 * localStorage when not in Tauri.
 */

import { ref, watch, type Ref } from 'vue'
import { isTauriEnv } from '@/utils/tauri'
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

export interface UseLocalStorageReturn {
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
  return isTauriEnv()
}

// Cache for reactive refs to avoid duplicates
const reactiveCache = new Map<string, Ref<unknown>>()

// Per-cacheKey internal updater that bypasses the local `watch` so
// cross-window broadcasts don't bounce back as another set+emit.
const reactiveUpdaters = new Map<string, (value: unknown) => void>()

// Cross-window pref sync. When window A's `set()` writes, broadcast
// `storage:changed` so window B's cached `reactive()` ref updates.
// Without this, the detach assistant window keeps its boot-time value
// even after the user toggles a setting in main settings.
const STORAGE_CHANGED_EVENT = 'storage:changed'
const crossWindowListener: { unlisten: (() => void) | null; ready: Promise<void> | null } = {
  unlisten: null,
  ready: null,
}

async function ensureCrossWindowListener() {
  if (crossWindowListener.ready) return crossWindowListener.ready
  if (!isTauriEnv()) {
    crossWindowListener.ready = Promise.resolve()
    return crossWindowListener.ready
  }
  crossWindowListener.ready = (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      crossWindowListener.unlisten = await listen<{ cacheKey: string; value: unknown }>(
        STORAGE_CHANGED_EVENT,
        (e) => {
          const update = reactiveUpdaters.get(e.payload.cacheKey)
          if (update) update(e.payload.value)
        },
      )
    } catch (err) {
      console.warn('[useLocalStorage] cross-window sync unavailable:', err)
    }
  })()
  return crossWindowListener.ready
}

async function broadcastChange(cacheKey: string, value: unknown) {
  if (!isTauriEnv()) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(STORAGE_CHANGED_EVENT, { cacheKey, value })
  } catch { /* best-effort */ }
}

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

export function useLocalStorage(): UseLocalStorageReturn {
  const isAvailable = ref(false)

  // Initialize availability check
  if (typeof window !== 'undefined') {
    isAvailable.value = isTauriEnvironment()
  }

  // ============================================
  // Simple Key-Value Operations
  // ============================================

  async function get<T = unknown>(key: string, options?: StorageOptions): Promise<T | null> {
    try {
      const storageKey = buildStorageKey(key, options)
      const value = localStorage.getItem(storageKey)
      return value ? JSON.parse(value) : null
    } catch (error) {
      console.error('[useLocalStorage] get error:', error)
      return null
    }
  }

  async function set(key: string, value: unknown, options?: StorageOptions): Promise<void> {
    try {
      const storageKey = buildStorageKey(key, options)
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch (error) {
      console.error('[useLocalStorage] set error:', error)
    }
  }

  async function remove(key: string, options?: StorageOptions): Promise<void> {
    try {
      const storageKey = buildStorageKey(key, options)
      localStorage.removeItem(storageKey)
    } catch (error) {
      console.error('[useLocalStorage] remove error:', error)
    }
  }

  // ============================================
  // Batch Operations
  // ============================================

  async function getMany<T = unknown>(keys: string[], options?: StorageOptions): Promise<Record<string, T>> {
    const result: Record<string, T> = {}
    for (const key of keys) {
      const value = await get<T>(key, options)
      if (value !== null) {
        result[key] = value
      }
    }
    return result
  }

  async function setMany(items: Record<string, unknown>, options?: StorageOptions): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      await set(key, value, options)
    }
  }

  // ============================================
  // List Operations
  // ============================================

  async function list(options?: StorageOptions): Promise<Array<{ key: string; value: unknown }>> {
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

    // Watch for changes and sync to storage + broadcast to siblings.
    watch(valueRef, async (newValue) => {
      if (isUpdating) return
      await set(key, newValue, options)
      await broadcastChange(cacheKey, newValue)
    }, { deep: true })

    // Cache the ref + register an internal updater the cross-window
    // listener can call without bouncing back through the local watch.
    reactiveCache.set(cacheKey, valueRef)
    reactiveUpdaters.set(cacheKey, (value) => {
      isUpdating = true
      valueRef.value = value as T
      isUpdating = false
    })
    void ensureCrossWindowListener()

    return valueRef
  }

  // ============================================
  // Project Settings
  // ============================================

  const projectSettings = {
    async get(projectId: number): Promise<ProjectLocalSettings | null> {
      return get<ProjectLocalSettings>(`project_${projectId}`, { category: 'project_settings' })
    },

    async set(projectId: number, settings: Partial<ProjectLocalSettings>): Promise<void> {
      const fullSettings: ProjectLocalSettings = {
        projectId,
        ...settings,
        updatedAt: new Date()
      }
      await set(`project_${projectId}`, fullSettings, { category: 'project_settings' })
    }
  }

  // ============================================
  // Pinned Items
  // ============================================

  const pinned = {
    async list(): Promise<PinnedItem[]> {
      const items = await list({ category: 'pinned' })
      return items
        .map(item => item.value as PinnedItem)
        .sort((a, b) => {
          if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
            return a.sortOrder - b.sortOrder
          }
          return new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime()
        })
    },

    async add(item: PinnedItem): Promise<void> {
      const pinnedItem: PinnedItem = {
        ...item,
        pinnedAt: item.pinnedAt || new Date().toISOString()
      }
      await set(`pinned_${item.id}`, pinnedItem, { category: 'pinned' })
    },

    async remove(id: string): Promise<void> {
      await remove(`pinned_${id}`, { category: 'pinned' })
    },

    async reorder(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
      for (const { id, sortOrder } of items) {
        const existing = await get<PinnedItem>(`pinned_${id}`, { category: 'pinned' })
        if (existing) {
          await set(`pinned_${id}`, { ...existing, sortOrder }, { category: 'pinned' })
        }
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

  const storage = useLocalStorage()

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
  const storage = useLocalStorage()

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
