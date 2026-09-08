/**
 * Profile-scoped localStorage wrapper.
 *
 * All keys are prefixed with the active profile ID so multiple profiles
 * sharing the same WebView origin don't collide.
 *
 * Usage: import { profileStorage } from '@/lib/profileStorage'
 *        profileStorage.getItem('my_key')  // reads '{profileId}:my_key'
 */

import { readonly, ref } from 'vue'

let _activeProfileId = 'default'
const activeProfileIdState = ref(_activeProfileId)
const migrationKey = '_profiles_ls_migrated'

function profilePrefix(profileId: string): string {
  return `${profileId}:`
}

/** Set the active profile ID. Called during profile init/switch. */
export function setActiveProfileId(id: string) {
  _activeProfileId = id
  activeProfileIdState.value = id
}

/** Get the active profile ID. */
export function getActiveProfileId(): string {
  return _activeProfileId
}

/** Reactive view of the active profile ID for in-app live switching. */
export const activeProfileIdRef = readonly(activeProfileIdState)

function prefixKey(key: string): string {
  return `${_activeProfileId}:${key}`
}

function clearProfileNamespace(profileId: string) {
  const prefix = profilePrefix(profileId)
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) {
      localStorage.removeItem(key)
    }
  }
}

export const profileStorage = {
  getItem(key: string): string | null {
    return localStorage.getItem(prefixKey(key))
  },

  setItem(key: string, value: string): void {
    localStorage.setItem(prefixKey(key), value)
  },

  removeItem(key: string): void {
    localStorage.removeItem(prefixKey(key))
  },

  /** Get all keys belonging to the active profile. */
  keys(): string[] {
    const prefix = `${_activeProfileId}:`
    const result: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) {
        result.push(key.slice(prefix.length))
      }
    }
    return result
  },
}

/** Clear all localStorage entries that belong to a given profile namespace. */
export function clearProfileStorage(profileId: string) {
  clearProfileNamespace(profileId)
}

/** Remove the accidental fallback namespace once a real profile is active. */
export function clearDefaultProfileStorage() {
  if (_activeProfileId === 'default') return
  clearProfileNamespace('default')
}

/**
 * Migrate unprefixed localStorage keys to the active profile.
 * Run once after first profile system init.
 */
export function migrateLocalStorage(profileId: string) {
  if (localStorage.getItem(migrationKey)) return

  const keysToMigrate = [
    // AI model
    'cp_default_ai_model',
    // Project store
    'construct_projects_root',
    'construct_recent_projects',
    'construct_external_paths',
    // Coder
    'coder:fast_mode',
    // Assistant chat
    'construct:assistant:histories:v1',
    'construct:assistant:selected-agent:v1',
    'construct:assistant:selected-model:v1',
    // Marketplace install metadata
    'construct:installed_spaces',
    // Pinned items
    'cp_pinned_items',
    // Theme
    'app-theme-id',
  ]

  for (const key of keysToMigrate) {
    const value = localStorage.getItem(key)
    if (value !== null) {
      localStorage.setItem(`${profileId}:${key}`, value)
      localStorage.removeItem(key)
    }
  }

  // Migrate coder session keys (coder:*:*)
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key && key.startsWith('coder:') && !key.startsWith(`${profileId}:`)) {
      const value = localStorage.getItem(key)
      if (value !== null) {
        localStorage.setItem(`${profileId}:${key}`, value)
        localStorage.removeItem(key)
      }
    }
  }

  localStorage.setItem(migrationKey, 'true')
}
