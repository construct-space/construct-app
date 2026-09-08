import { isTauriEnv } from '@/utils/tauri'

export type WindowType = 'main' | 'space-preview' | 'web-preview' | 'detach'

export async function getWindowLabel(): Promise<string | null> {
  if (!isTauriEnv()) return null
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    return getCurrentWebviewWindow().label
  } catch {
    return null
  }
}

/**
 * True when a label is a *space popout* window — `main-<spaceId>`,
 * `main-<projectId>-<spaceId>`, or `main-runner` — as opposed to the
 * primary `main` window or an *extra Construct window*.
 *
 * Extra windows (File ▸ New Construct Window / Cmd+N) are labelled
 * `main-<timestamp>` — a purely-numeric suffix. Those are full main
 * windows and must keep the complete sidebar/titlebar, so they are NOT
 * popouts. Space ids are slugs and never purely numeric, and project
 * popouts carry a dash, so the numeric check is unambiguous.
 */
export function isSpacePopoutLabel(label: string | null): boolean {
  if (!label || label === 'main' || !label.startsWith('main-')) return false
  const id = label.slice('main-'.length)
  if (!id) return false
  if (/^\d+$/.test(id)) return false // extra Construct window, not a popout
  return true
}

export function resolveWindowTypeFromLabel(label: string | null): WindowType {
  if (!label || label === 'main') return 'main'
  // Order matters: preview-web-* must match BEFORE the generic preview-*
  // check, otherwise web previews get routed through SpacePreviewShell.
  if (label.startsWith('preview-web-')) return 'web-preview'
  if (label.startsWith('preview-')) return 'space-preview'
  if (label.startsWith('detach-space-') || label.startsWith('detach-assistant-')) return 'detach'
  return 'main'
}

/**
 * Hash-based fallback. The window URL is authoritative about which shell
 * should render regardless of Tauri label resolution success. This
 * prevents main-window bootstrap from accidentally running in a detached
 * or browser window if getCurrentWebviewWindow() ever fails.
 */
export function resolveWindowTypeFromHash(hash: string): WindowType | null {
  const h = hash.replace(/^#/, '')
  if (h.startsWith('/detach/')) return 'detach'
  if (h.startsWith('/preview-web')) return 'web-preview'
  if (h.startsWith('/preview/')) return 'space-preview'
  return null
}

export async function resolveWindowType(): Promise<WindowType> {
  const byHash = resolveWindowTypeFromHash(typeof location !== 'undefined' ? location.hash : '')
  if (byHash) return byHash
  return resolveWindowTypeFromLabel(await getWindowLabel())
}
