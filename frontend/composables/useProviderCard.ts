/**
 * Shared state for provider-settings cards. Every card in
 * `components/settings/providers/` composes this so the key management,
 * mode selection, and configured-state tracking stay consistent.
 *
 * Per-provider differences (OAuth flows, dual-key wiring, URL-only local
 * runtimes) live in the individual card components — this composable
 * just owns the common plumbing.
 */

import { computed, reactive, ref } from 'vue'
import { useBrain } from '@/brain'
import { profileStorage } from '@/lib/profileStorage'

export type ModeKey = 'api_key' | 'monthly'

// Where a credential lives in the kv store. Most providers just use
// `provider_key:<id>`. Providers with a separate monthly-plan key
// (MiMo's token plan) use `provider_key_monthly:<id>`.
export function apiKeySlot(providerId: string, mode: ModeKey = 'api_key'): string {
  return mode === 'monthly'
    ? `provider_key_monthly:${providerId}`
    : `provider_key:${providerId}`
}

// Top-level state — shared across every card so mode selection is
// consistent and key-draft state doesn't leak when switching providers.
const drafts = reactive<Record<string, string>>({})
const visible = reactive<Record<string, boolean>>({})
const saving = reactive<Record<string, boolean>>({})
const saved = reactive<Record<string, boolean>>({})
const configured = reactive<Record<string, boolean>>({})
const modeByProvider = reactive<Record<string, ModeKey>>({})
const collapsedByProvider = reactive<Record<string, boolean>>({})

// Bumped whenever a card saves/removes a key. Other views (e.g. the
// providers panel, which maintains its own "configured?" snapshot for
// filtering) can watch this to know it's time to re-query.
export const configuredVersion = ref(0)

function modeStorageKey(providerId: string) {
  return `cp_provider_mode:${providerId}`
}

function collapseStorageKey(providerId: string) {
  return `cp_provider_collapsed:${providerId}`
}

interface SettingResponse {
  value?: string
}

export function useProviderCard() {
  const brain = useBrain()

  // Keys persist via `settings.set` — the IPC that also triggers brain's
  // settings hook (formerly the operator SettingsHook) responsible for
  // registering the corresponding provider connector with the runner.
  // Writing via plain `kv.set` skips the hook, which is why saved keys
  // never produced a registered connector (e.g. "connector 'mimo' not
  // registered").
  async function getSetting(key: string): Promise<string> {
    try {
      const res = (await brain.request('settings.get', { key })) as SettingResponse
      return (res?.value as string) || ''
    } catch {
      return ''
    }
  }
  async function setSetting(key: string, value: string): Promise<void> {
    await brain.request('settings.set', { key, value })
  }

  async function loadConfigured(providerId: string, slot?: string) {
    const key = slot || apiKeySlot(providerId)
    const v = await getSetting(key)
    configured[`${providerId}:${key}`] = !!v
  }

  function isConfigured(providerId: string, slot?: string): boolean {
    const key = slot || apiKeySlot(providerId)
    return !!configured[`${providerId}:${key}`]
  }

  async function saveKey(providerId: string, value: string, slot?: string) {
    const trimmed = (value || '').trim()
    if (!trimmed) return false
    const key = slot || apiKeySlot(providerId)
    const handle = `${providerId}:${key}`
    saving[handle] = true
    try {
      await setSetting(key, trimmed)
      configured[handle] = true
      saved[handle] = true
      drafts[handle] = ''
      configuredVersion.value++
      setTimeout(() => { saved[handle] = false }, 2000)
      return true
    } finally {
      saving[handle] = false
    }
  }

  async function removeKey(providerId: string, slot?: string) {
    const key = slot || apiKeySlot(providerId)
    const handle = `${providerId}:${key}`
    // Empty string triggers the hook's "unset" branch → RemoveProvider.
    await setSetting(key, '').catch(() => { /* best effort */ })
    configured[handle] = false
    drafts[handle] = ''
    configuredVersion.value++
  }

  function draftRef(providerId: string, slot?: string) {
    const handle = `${providerId}:${slot || apiKeySlot(providerId)}`
    if (!(handle in drafts)) drafts[handle] = ''
    return computed({
      get: () => drafts[handle] || '',
      set: (v: string) => { drafts[handle] = v },
    })
  }

  function visibilityRef(providerId: string, slot?: string) {
    const handle = `${providerId}:${slot || apiKeySlot(providerId)}`
    return computed({
      get: () => !!visible[handle],
      set: (v: boolean) => { visible[handle] = v },
    })
  }

  function isSaving(providerId: string, slot?: string): boolean {
    return !!saving[`${providerId}:${slot || apiKeySlot(providerId)}`]
  }

  function justSaved(providerId: string, slot?: string): boolean {
    return !!saved[`${providerId}:${slot || apiKeySlot(providerId)}`]
  }

  // Mode selection per provider.
  function activeMode(providerId: string): ModeKey {
    if (modeByProvider[providerId]) return modeByProvider[providerId]
    const stored = profileStorage.getItem(modeStorageKey(providerId)) as ModeKey | null
    if (stored === 'api_key' || stored === 'monthly') {
      modeByProvider[providerId] = stored
      return stored
    }
    return 'api_key'
  }

  function setActiveMode(providerId: string, mode: ModeKey) {
    modeByProvider[providerId] = mode
    profileStorage.setItem(modeStorageKey(providerId), mode)
  }

  function isCollapsed(providerId: string): boolean {
    if (providerId in collapsedByProvider) return collapsedByProvider[providerId]
    const stored = profileStorage.getItem(collapseStorageKey(providerId))
    const collapsed = stored === null ? true : stored === 'true'
    collapsedByProvider[providerId] = collapsed
    return collapsed
  }

  function setCollapsed(providerId: string, collapsed: boolean) {
    collapsedByProvider[providerId] = collapsed
    profileStorage.setItem(collapseStorageKey(providerId), String(collapsed))
  }

  function toggleCollapsed(providerId: string) {
    setCollapsed(providerId, !isCollapsed(providerId))
  }

  return {
    draftRef,
    visibilityRef,
    isSaving,
    justSaved,
    isConfigured,
    loadConfigured,
    saveKey,
    removeKey,
    activeMode,
    setActiveMode,
    isCollapsed,
    setCollapsed,
    toggleCollapsed,
  }
}
