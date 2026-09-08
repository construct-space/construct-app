/**
 * useOnboarding — onboarding completion persistence
 *
 * Stored in `construct-settings.json` (Tauri store) so completion survives
 * a localStorage wipe (e.g. when the dev tools "Clear storage" button is
 * used or when the webview is rebuilt). Falls back to localStorage in
 * non-Tauri environments (web dev).
 *
 * Migrates pre-existing `cp_onboarding_complete:<userId>` localStorage
 * values on first read so users who already onboarded aren't shown the
 * flow again after upgrading.
 */

import { getTauriStore } from './useTauriStore'

const KEY_PREFIX = 'onboarding_complete:'
const LEGACY_PREFIX = 'cp_onboarding_complete:'

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`
}

function legacyKey(userId: string): string {
  return `${LEGACY_PREFIX}${userId}`
}

export async function isOnboardingComplete(userId: string): Promise<boolean> {
  if (!userId) return false
  const store = await getTauriStore()
  if (store) {
    const v = await store.get<boolean>(key(userId))
    if (v) return true
    // One-shot migration: if a legacy localStorage value exists, copy it
    // into the Tauri store and drop the original. After this runs once,
    // subsequent reads hit the Tauri store directly.
    if (localStorage.getItem(legacyKey(userId))) {
      await store.set(key(userId), true)
      localStorage.removeItem(legacyKey(userId))
      return true
    }
    return false
  }
  // Web/dev fallback
  return !!localStorage.getItem(legacyKey(userId))
}

export async function markOnboardingComplete(userId: string): Promise<void> {
  if (!userId) return
  const store = await getTauriStore()
  if (store) {
    await store.set(key(userId), true)
    localStorage.removeItem(legacyKey(userId))
    return
  }
  localStorage.setItem(legacyKey(userId), 'true')
}

export async function clearOnboarding(userId: string): Promise<void> {
  if (!userId) return
  const store = await getTauriStore()
  if (store) await store.delete(key(userId))
  localStorage.removeItem(legacyKey(userId))
  localStorage.removeItem('cp_onboarding_complete')
}
