import { invoke } from '@tauri-apps/api/core'
import { isTauriEnv } from '@/utils/tauri'

export type DockIconState = 'default' | 'dev' | 'update' | 'error' | 'busy'

/**
 * Set the macOS dock icon state.
 *   - "default" — normal green icon
 *   - "update"  — blue badge (update available)
 *   - "error"   — red badge (something went wrong)
 *   - "busy"    — orange badge (processing)
 */
export async function setDockIcon(state: DockIconState): Promise<void> {
  if (!isTauriEnv()) return
  try {
    await invoke('set_dock_icon', { state })
  } catch (e) {
    console.warn('[dock] Failed to set icon state:', e)
  }
}
