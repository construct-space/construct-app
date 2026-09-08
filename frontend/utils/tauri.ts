/**
 * Tauri detection utility — shared across composables
 */
export function isTauriEnv(): boolean {
  if (import.meta.env.VITE_TAURI === 'true') return true
  return typeof window !== 'undefined' && (
    window.location?.protocol === 'tauri:' ||
    window.location?.hostname === 'tauri.localhost' ||
    '__TAURI__' in window ||
    '__TAURI_INTERNALS__' in window
  )
}
