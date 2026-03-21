/**
 * Open a space in a separate Tauri preview window.
 *
 * Used for testing spaces during development. The preview window:
 * - Loads the space IIFE independently
 * - Polls for rebuilds and hot-reloads automatically
 * - Doesn't affect the main Construct window
 *
 * Usage:
 *   const { openPreview } = useSpacePreview()
 *   openPreview('myspace')
 */

import { isTauriEnv } from '@/utils/tauri'

export function useSpacePreview() {
  async function openPreview(spaceId: string, subPage?: string) {
    if (!isTauriEnv()) {
      // In browser, just open a new tab
      const path = subPage ? `/preview/${spaceId}/${subPage}` : `/preview/${spaceId}`
      window.open(path, `preview-${spaceId}`)
      return
    }

    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const label = `preview-${spaceId}`

      // Focus existing preview window if already open
      const existing = await WebviewWindow.getByLabel(label)
      if (existing) {
        await existing.setFocus()
        return
      }

      const path = subPage ? `/preview/${spaceId}/${subPage}` : `/preview/${spaceId}`
      const previewWindow = new WebviewWindow(label, {
        url: path,
        title: `Preview — ${spaceId}`,
        width: 1200,
        height: 800,
        center: true,
        decorations: true,
        resizable: true,
        minimizable: true,
        maximizable: true,
      })

      previewWindow.once('tauri://error', (e) => {
        console.error(`[SpacePreview] Failed to open window for "${spaceId}":`, e)
      })
    } catch (err) {
      console.error('[SpacePreview] Error:', err)
    }
  }

  async function closePreview(spaceId: string) {
    if (!isTauriEnv()) return
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const win = await WebviewWindow.getByLabel(`preview-${spaceId}`)
      if (win) await win.close()
    } catch { /* ignore */ }
  }

  return { openPreview, closePreview }
}
