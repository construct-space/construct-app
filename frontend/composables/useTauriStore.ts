/**
 * useTauriStore — Singleton wrapper around @tauri-apps/plugin-store
 *
 * Provides a persistent key-value store backed by the Tauri store plugin.
 * Settings live per-profile at
 * `${dataDir}/profiles/<activeProfileId>/construct-settings.json`, so two
 * profiles on the same machine don't share onboarding/telemetry/UI state.
 * Falls back to a profile-less path when no profile is active yet (first
 * launch) and to a relative path in non-Tauri (web dev) environments.
 */

import type { Store } from '@tauri-apps/plugin-store'

let _store: Store | null = null
let _storePath = ''
let _storePromise: Promise<Store | null> | null = null
let _storeFailed = false

async function resolveStorePath(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  let dataDir: string
  try {
    dataDir = (await invoke<string>('get_data_dir')).replace(/\/+$/, '')
  } catch {
    return 'construct-settings.json'
  }
  // Read the desktop registry to find which profile is active. Done via
  // plugin-fs (rather than the profile Pinia store) so this composable
  // stays usable from places that haven't initialized the store yet
  // (auth bootstrap, route guards, telemetry).
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const regPath = `${dataDir}/profiles.json`
    if (await exists(regPath)) {
      const reg = JSON.parse(await readTextFile(regPath)) as { active_profile?: string }
      if (reg.active_profile) {
        return `${dataDir}/profiles/${reg.active_profile}/construct-settings.json`
      }
    }
  } catch { /* fall through to legacy path */ }
  // No active profile yet — keep the legacy root path so first-launch
  // settings (e.g. theme picked before sign-in) aren't lost.
  return `${dataDir}/construct-settings.json`
}

export async function getTauriStore(): Promise<Store | null> {
  if (_storeFailed) return null
  if (_store) return _store
  if (_storePromise) return _storePromise

  _storePromise = (async () => {
    try {
      const { load } = await import('@tauri-apps/plugin-store')
      const storePath = await resolveStorePath()
      const store = await load(storePath, { defaults: {}, autoSave: true })
      _store = store
      _storePath = storePath
      return store
    } catch {
      _storeFailed = true
      _storePromise = null
      return null
    }
  })()

  return _storePromise
}

/**
 * Reset the cached store handle so the next `getTauriStore()` call rebinds
 * to the current active profile. Call this when the user switches profile
 * or signs out — otherwise we'd keep writing the previous profile's
 * settings to the new session.
 */
export async function resetTauriStore(): Promise<void> {
  if (_store) {
    try { await _store.close() } catch { /* ignore */ }
  }
  _store = null
  _storePath = ''
  _storePromise = null
  _storeFailed = false
}

/** Path of the currently-bound store, for diagnostics. Empty until first load. */
export function tauriStorePath(): string {
  return _storePath
}
