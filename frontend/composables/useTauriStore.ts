/**
 * useTauriStore — Singleton wrapper around @tauri-apps/plugin-store
 *
 * Provides a persistent key-value store backed by the Tauri store plugin.
 * Falls back gracefully in non-Tauri (web dev) environments.
 */

import type { Store } from '@tauri-apps/plugin-store'

let _store: Store | null = null
let _storePromise: Promise<Store | null> | null = null
let _storeFailed = false

export async function getTauriStore(): Promise<Store | null> {
  if (_storeFailed) return null
  if (_store) return _store
  if (_storePromise) return _storePromise

  _storePromise = (async () => {
    try {
      const { load } = await import('@tauri-apps/plugin-store')
      const store = await load('construct-settings.json', { defaults: {}, autoSave: true })
      _store = store
      return store
    } catch {
      _storeFailed = true
      _storePromise = null
      return null
    }
  })()

  return _storePromise
}
