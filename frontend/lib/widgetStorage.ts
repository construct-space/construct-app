/**
 * Widget layout persistence — profile-scoped JSON file.
 *
 * Path: <dataDir>/profiles/<profileId>/widgets.json
 *
 * Falls back to profileStorage (localStorage) when not running in Tauri
 * — keeps `bun run dev:frontend` working without the desktop sidecar.
 *
 * On first load with no file, seeds from the legacy localStorage key
 * (`construct:home_layout`) so existing users don't lose their layout.
 */

import { profileStorage, getActiveProfileId } from '@/lib/profileStorage'
import { isTauriEnv } from '@/utils/tauri'
import type { HomeLayout } from '@/composables/useWidgetRegistry'

const LEGACY_LS_KEY = 'construct:home_layout'
const FILE_NAME = 'widgets.json'

let dirEnsured = false

function isTauri(): boolean {
  return isTauriEnv()
}

async function widgetsPath(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const base = await invoke<string>('get_construct_data_dir')
    if (!base) return null
    const baseTrim = base.replace(/\/+$/, '')
    const profileId = getActiveProfileId()
    return `${baseTrim}/profiles/${profileId}/${FILE_NAME}`
  } catch {
    return null
  }
}

async function ensureProfileDir(filePath: string): Promise<void> {
  if (dirEnsured) return
  try {
    const { mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const dir = filePath.slice(0, filePath.lastIndexOf('/'))
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true })
    }
    dirEnsured = true
  } catch (e) {
    console.warn('[widgetStorage] ensureProfileDir failed:', e)
  }
}

/**
 * Load the home layout for the active profile.
 *
 * Resolution order:
 *   1. <dataDir>/profiles/<profileId>/widgets.json      (Tauri only)
 *   2. legacy localStorage `construct:home_layout`       (one-shot migration)
 *   3. null
 *
 * Migration writes the file once and leaves the legacy key in place for
 * one release as a safety net.
 */
export async function loadHomeLayout(): Promise<HomeLayout | null> {
  const path = await widgetsPath()

  // 1) File path
  if (path) {
    try {
      const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
      if (await exists(path)) {
        const raw = await readTextFile(path)
        return JSON.parse(raw) as HomeLayout
      }
    } catch (e) {
      console.warn('[widgetStorage] read failed, falling back:', e)
    }
  }

  // 2) Legacy localStorage migration
  const legacy = profileStorage.getItem(LEGACY_LS_KEY)
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as HomeLayout
      if (path) {
        // Best-effort seed; don't block load on a write failure.
        void saveHomeLayout(parsed).catch(() => {})
      }
      return parsed
    } catch {
      // Corrupt JSON — ignore and return null.
    }
  }

  return null
}

/**
 * Persist the home layout for the active profile.
 *
 * Writes to disk in Tauri, falls back to localStorage in plain web dev.
 * Errors are logged but never thrown — a failed save shouldn't crash the
 * UI; the in-memory layout still works for the session.
 */
export async function saveHomeLayout(layout: HomeLayout): Promise<void> {
  const json = JSON.stringify(layout, null, 2)

  // localStorage shadow write keeps the legacy key warm for one release.
  // Cheap and synchronous, so do it regardless of backend.
  try {
    profileStorage.setItem(LEGACY_LS_KEY, json)
  } catch { /* storage quota / disabled — ignore */ }

  const path = await widgetsPath()
  if (!path) return

  try {
    await ensureProfileDir(path)
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(path, json)
  } catch (e) {
    console.warn('[widgetStorage] write failed:', e)
  }
}
