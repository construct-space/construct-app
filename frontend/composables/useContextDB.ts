/**
 * useContextDB — typed adapter over brain wire-ops for persistent app
 * state (pinned items, KV, settings, project settings, AI conversations).
 *
 * Despite the name, there's no SQLite involved — brain stores each map
 * as JSON files under `<profileDir>/brain/state/`. The "DB" suffix is
 * historical; this composable will be renamed to `useBrainStore` as
 * part of the operator removal sweep.
 */

import type { PinnedItem } from '~/stores/pinned'
import { useBrain } from '@/brain'
import { db } from '@/utils/db'

export interface ContextProjectSettings {
  projectId: number
  localPath?: string
  editorPath?: string
  syncedAt?: string
  updatedAt: string
}

export interface KVEntry {
  key: string
  value: string
  category?: string
  user_id?: string
  project_id?: number
}

export interface AIConversation {
  id: string
  context_key: string
  name: string
  model: string
  messages_json?: string
  mode?: 'single' | 'roundrobin'
  invited_models?: string // JSON array of composite model IDs
  created_at: string
  updated_at: string
}

export function useContextDB() {
  const brain = useBrain()
  const { isTauri, connected } = brain

  // Helper to ensure connection before making requests.
  // Uses exponential backoff (2x growth, capped at 3s) with limited retries.
  async function ensureConnected(maxRetries = 8, delayMs = 300): Promise<boolean> {
    const _t = performance.now()
    if (!isTauri.value) return false

    // If already connected, return immediately
    if (connected.value) {
      //   console.log('[perf] contextDB.ensureConnected: already connected:', (performance.now() - _t).toFixed(1), 'ms')
      return true
    }

    // Try to connect once eagerly
    try {
      await brain.connect()
    } catch {
      // Connection might fail, continue to retry loop
    }

    let retries = 0
    while (!connected.value && retries < maxRetries) {
      const delay = Math.min(delayMs * Math.pow(2, retries), 3000)
      await new Promise(resolve => setTimeout(resolve, delay))
      retries++
      // Try to reconnect every other retry
      if (!connected.value && retries % 2 === 0) {
        try {
          await brain.connect()
        } catch {
          // Ignore connection errors, keep retrying
        }
      }
    }
    //console.log('[perf] contextDB.ensureConnected:', connected.value ? 'connected' : 'FAILED', 'after', retries, 'retries,', (performance.now() - _t).toFixed(1), 'ms')
    return connected.value
  }

  // ============================================================================
  // Pinned Items
  // ============================================================================

  // Pinned items now live in IndexedDB — they're pure UI state, brain
  // has no use for them. No connection check, no operator round-trip.
  // The composable surface stays the same so callers don't change.
  async function pinnedList(): Promise<PinnedItem[]> {
    try {
      const items = await db.pinned.toArray()
      // Mirror operator's old ordering: sortOrder ascending, ties broken
      // by pinnedAt descending (newest first).
      return items.sort((a, b) => {
        if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
          return a.sortOrder - b.sortOrder
        }
        if (a.sortOrder !== undefined) return -1
        if (b.sortOrder !== undefined) return 1
        return (b.pinnedAt || '').localeCompare(a.pinnedAt || '')
      })
    } catch (error) {
      console.error('[ContextDB] pinnedList failed:', error)
      return []
    }
  }

  async function pinnedAdd(item: PinnedItem): Promise<boolean> {
    try {
      // IndexedDB's structured-clone algorithm rejects Vue reactive
      // Proxies — items coming from a Pinia store hit DataCloneError
      // here. JSON round-trip strips the proxy + any non-cloneable
      // wrappers; PinnedItem only carries primitives + a plain
      // metadata object, so no fidelity is lost.
      await db.pinned.put(JSON.parse(JSON.stringify(item)))
      return true
    } catch (error) {
      console.error('[ContextDB] pinnedAdd failed:', error)
      return false
    }
  }

  async function pinnedRemove(id: string): Promise<boolean> {
    try {
      await db.pinned.delete(id)
      return true
    } catch (error) {
      console.error('[ContextDB] pinnedRemove failed:', error)
      return false
    }
  }

  async function pinnedReorder(orderedIds: string[]): Promise<boolean> {
    try {
      // Bulk-update sortOrder in one transaction — keeps the list
      // consistent even if a drag ends mid-write.
      await db.transaction('rw', db.pinned, async () => {
        await Promise.all(
          orderedIds.map((id, index) =>
            db.pinned.update(id, { sortOrder: index }),
          ),
        )
      })
      return true
    } catch (error) {
      console.error('[ContextDB] pinnedReorder failed:', error)
      return false
    }
  }

  // ============================================================================
  // Project Local Settings
  // ============================================================================

  async function projectSettingsGet(projectId: number): Promise<ContextProjectSettings | null> {
    if (!await ensureConnected()) return null
    try {
      const result = await brain.request<{
        projectId: number
        localPath?: string
        editorPath?: string
        syncedAt?: string
        updatedAt?: string
      }>('project_settings.get', {
        projectId,
      })

      if (!result || typeof result.projectId !== 'number') return null

      return {
        projectId: result.projectId,
        localPath: result.localPath,
        editorPath: result.editorPath,
        syncedAt: result.syncedAt,
        updatedAt: result.updatedAt || new Date().toISOString(),
      }
    } catch (error) {
      console.error('[ContextDB] projectSettingsGet failed:', error)
      return null
    }
  }

  async function projectSettingsSet(settings: ContextProjectSettings): Promise<boolean> {
    if (!await ensureConnected()) return false
    try {
      await brain.request('project_settings.set', {
        projectId: settings.projectId,
        localPath: settings.localPath,
        editorPath: settings.editorPath
      })
      return true
    } catch (error) {
      console.error('[ContextDB] projectSettingsSet failed:', error)
      return false
    }
  }

  // ============================================================================
  // Key-Value Store
  // ============================================================================

  async function kvGet(key: string): Promise<string | null> {
    if (!await ensureConnected()) return null
    try {
      const result = await brain.request<{ value?: string }>('kv.get', { key })
      return result?.value ?? null
    } catch (error) {
      console.error('[ContextDB] kvGet failed:', error)
      return null
    }
  }

  async function kvSet(key: string, value: string, category?: string): Promise<boolean> {
    if (!await ensureConnected()) return false
    try {
      await brain.request('kv.set', { key, value, category })
      return true
    } catch (error) {
      console.error('[ContextDB] kvSet failed:', error)
      return false
    }
  }

  async function kvDelete(key: string): Promise<boolean> {
    if (!await ensureConnected()) return false
    try {
      await brain.request('kv.delete', { key })
      return true
    } catch (error) {
      console.error('[ContextDB] kvDelete failed:', error)
      return false
    }
  }

  async function kvList(category?: string): Promise<KVEntry[]> {
    if (!await ensureConnected()) return []
    try {
      const result = await brain.request<{ entries?: KVEntry[] }>('kv.list', { category })
      return result?.entries || []
    } catch (error) {
      console.error('[ContextDB] kvList failed:', error)
      return []
    }
  }

  // ============================================================================
  // Settings (special KV with 'settings' category)
  // ============================================================================

  async function settingGet(key: string): Promise<string | null> {
    if (!await ensureConnected()) return null
    try {
      const result = await brain.request<{ value?: string }>('settings.get', { key })
      return result?.value ?? null
    } catch (error) {
      console.error('[ContextDB] settingGet failed:', error)
      return null
    }
  }

  async function settingSet(key: string, value: string): Promise<boolean> {
    if (!await ensureConnected()) return false
    try {
      await brain.request('settings.set', { key, value })
      return true
    } catch (error) {
      console.error('[ContextDB] settingSet failed:', error)
      return false
    }
  }

  // ============================================================================
  // AI Conversations
  // ============================================================================

  const AI_SPACE_CONVERSATIONS_KEY = 'ai_space.conversations.v1'

  function createConversationId() {
    return `ai-conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  function sortConversationsByUpdatedAt(conversations: AIConversation[]): AIConversation[] {
    return [...conversations].sort((a, b) => {
      const aTime = new Date(a.updated_at).getTime()
      const bTime = new Date(b.updated_at).getTime()
      return bTime - aTime
    })
  }

  function normalizeConversation(input: Partial<AIConversation>): AIConversation | null {
    const id = (input.id || '').toString().trim()
    if (!id) return null

    const now = new Date().toISOString()
    const createdAt = typeof input.created_at === 'string' && input.created_at ? input.created_at : now
    const updatedAt = typeof input.updated_at === 'string' && input.updated_at ? input.updated_at : createdAt

    return {
      id,
      context_key: (input.context_key || 'project:global').toString(),
      name: (input.name || 'New Conversation').toString(),
      model: (input.model || 'auto').toString(),
      messages_json: typeof input.messages_json === 'string' ? input.messages_json : '[]',
      mode: input.mode === 'roundrobin' ? 'roundrobin' : 'single',
      invited_models: typeof input.invited_models === 'string' ? input.invited_models : '[]',
      created_at: createdAt,
      updated_at: updatedAt,
    }
  }

  async function readConversationFallback(): Promise<AIConversation[]> {
    try {
      const raw = await kvGet(AI_SPACE_CONVERSATIONS_KEY)
      if (!raw) return []

      const parsed = JSON.parse(raw) as unknown
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object'
          ? Object.values(parsed as Record<string, unknown>)
          : [])

      const normalized = list
        .map(item => normalizeConversation(item as Partial<AIConversation>))
        .filter((item): item is AIConversation => !!item)

      return sortConversationsByUpdatedAt(normalized)
    } catch {
      return []
    }
  }

  async function writeConversationFallback(conversations: AIConversation[]): Promise<boolean> {
    return kvSet(AI_SPACE_CONVERSATIONS_KEY, JSON.stringify(sortConversationsByUpdatedAt(conversations)), 'ai')
  }

  async function conversationList(contextKey?: string): Promise<AIConversation[]> {
    if (!await ensureConnected()) return []

    const applyFilter = (list: AIConversation[]) => {
      if (!contextKey) return list
      return list.filter(conv => conv.context_key === contextKey)
    }

    try {
      const result = await brain.request<{ conversations?: AIConversation[] }>('ai.conversations.list', {
        context_key: contextKey
      })
      const normalized = (result?.conversations || [])
        .map(conv => normalizeConversation(conv))
        .filter((conv): conv is AIConversation => !!conv)
      return applyFilter(sortConversationsByUpdatedAt(normalized))
    } catch (error) {
      console.warn('[ContextDB] conversationList fallback to KV:', error)
      const fallback = await readConversationFallback()
      return applyFilter(fallback)
    }
  }

  async function conversationGet(id: string): Promise<AIConversation | null> {
    if (!await ensureConnected()) return null
    try {
      const conversation = await brain.request<AIConversation>('ai.conversations.get', { id })
      return normalizeConversation(conversation)
    } catch (error) {
      console.warn('[ContextDB] conversationGet fallback to KV:', error)
      const fallback = await readConversationFallback()
      return fallback.find(conv => conv.id === id) || null
    }
  }

  async function conversationSave(conversation: Partial<AIConversation> & { context_key: string; name: string }): Promise<string | null> {
    if (!await ensureConnected()) return null

    const now = new Date().toISOString()
    const normalized: AIConversation = {
      id: conversation.id?.toString().trim() || createConversationId(),
      context_key: conversation.context_key,
      name: conversation.name,
      model: (conversation.model || 'auto').toString(),
      messages_json: typeof conversation.messages_json === 'string' ? conversation.messages_json : '[]',
      mode: conversation.mode === 'roundrobin' ? 'roundrobin' : 'single',
      invited_models: typeof conversation.invited_models === 'string' ? conversation.invited_models : '[]',
      created_at: conversation.created_at || now,
      updated_at: now,
    }

    try {
      const result = await brain.request<{ id: string }>('ai.conversations.save', conversation as unknown as Record<string, unknown>)
      if (result?.id) return result.id
    } catch (error) {
      console.warn('[ContextDB] conversationSave fallback to KV:', error)
    }

    try {
      const fallback = await readConversationFallback()
      const existingIndex = fallback.findIndex(conv => conv.id === normalized.id)

      if (existingIndex >= 0) {
        const existing = fallback[existingIndex]
        if (!existing) return null
        fallback[existingIndex] = {
          ...existing,
          ...normalized,
          created_at: existing.created_at,
          updated_at: now,
        }
      } else {
        fallback.unshift(normalized)
      }

      const saved = await writeConversationFallback(fallback)
      return saved ? normalized.id : null
    } catch (error) {
      console.error('[ContextDB] conversationSave fallback write failed:', error)
      return null
    }
  }

  async function conversationDelete(id: string): Promise<boolean> {
    if (!await ensureConnected()) return false
    let remoteDeleted = false

    try {
      await brain.request('ai.conversations.delete', { id })
      remoteDeleted = true
    } catch (error) {
      console.warn('[ContextDB] conversationDelete fallback to KV:', error)
    }

    try {
      const fallback = await readConversationFallback()
      const next = fallback.filter(conv => conv.id !== id)
      const localDeleted = await writeConversationFallback(next)
      return remoteDeleted || localDeleted
    } catch (error) {
      console.error('[ContextDB] conversationDelete fallback write failed:', error)
      return remoteDeleted
    }
  }

  return {
    // Connection
    isTauri,
    connected,
    ensureConnected,

    // Pinned Items
    pinnedList,
    pinnedAdd,
    pinnedRemove,
    pinnedReorder,

    // Project Settings
    projectSettingsGet,
    projectSettingsSet,

    // Key-Value Store
    kvGet,
    kvSet,
    kvDelete,
    kvList,

    // Settings
    settingGet,
    settingSet,

    // AI Conversations
    conversationList,
    conversationGet,
    conversationSave,
    conversationDelete
  }
}
