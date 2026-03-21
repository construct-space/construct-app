/**
 * ConstructWindow — open a managed Tauri window from any space.
 *
 * Wraps Tauri's WebviewWindow API to create, focus, navigate, and close
 * child windows. Falls back to window.open() in non-Tauri environments.
 *
 * Usage:
 *   const { open, close } = useConstructWindow()
 *   const win = await open('https://example.com', { title: 'Docs' })
 *   await close(win)
 */

import { ref, type Ref } from 'vue'
import { isTauriEnv } from '@/utils/tauri'

export interface ConstructWindowOptions {
  /** Window title (default: 'Construct Browser') */
  title?: string
  /** Window width in px (default: 1200) */
  width?: number
  /** Window height in px (default: 820) */
  height?: number
  /** Center on screen (default: true) */
  center?: boolean
  /** Show native decorations (default: true) */
  decorations?: boolean
  /** Allow resizing (default: true) */
  resizable?: boolean
  /** Keep above other windows (default: false) */
  alwaysOnTop?: boolean
  /** Show in OS taskbar/dock (default: true) */
  skipTaskbar?: boolean
  /** Start visible (default: true) */
  visible?: boolean
  /** Unique label — auto-generated if omitted */
  label?: string
}

export interface ConstructWindow {
  /** Unique Tauri window label */
  label: string
  /** URL currently loaded */
  url: string
  /** Underlying Tauri WebviewWindow instance (null in browser fallback) */
  _tauriWindow: unknown | null
  /** Browser fallback window ref */
  _browserWindow: globalThis.Window | null
}

const LABEL_PREFIX = 'construct-window-'
let counter = 0

function nextLabel(): string {
  return `${LABEL_PREFIX}${Date.now()}-${++counter}`
}

/** All currently tracked windows */
const openWindows: Ref<ConstructWindow[]> = ref([])

export function useConstructWindow() {
  /**
   * Open a new window (or focus existing by label).
   */
  async function open(
    url: string,
    options: ConstructWindowOptions = {},
  ): Promise<ConstructWindow> {
    const label = options.label ?? nextLabel()

    // ── Tauri path ──────────────────────────────────────────────────────
    if (isTauriEnv()) {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')

        // Re-focus if a window with this label already exists
        const existing = await WebviewWindow.getByLabel(label)
        if (existing) {
          await existing.setFocus()
          const tracked = openWindows.value.find((w) => w.label === label)
          if (tracked) {
            tracked.url = url
            return tracked
          }
        }

        const win = new WebviewWindow(label, {
          url,
          title: options.title ?? 'Construct Browser',
          width: options.width ?? 1200,
          height: options.height ?? 820,
          center: options.center ?? true,
          decorations: options.decorations ?? true,
          resizable: options.resizable ?? true,
          alwaysOnTop: options.alwaysOnTop ?? false,
          skipTaskbar: options.skipTaskbar ?? false,
          visible: options.visible ?? true,
          minimizable: true,
          maximizable: true,
          closable: true,
        })

        const entry: ConstructWindow = {
          label,
          url,
          _tauriWindow: win,
          _browserWindow: null,
        }

        // Clean up tracking on close
        win.once('tauri://destroyed', () => {
          openWindows.value = openWindows.value.filter((w) => w.label !== label)
        })

        win.once('tauri://error', (e) => {
          console.error(`[ConstructWindow] "${label}" error:`, e)
          openWindows.value = openWindows.value.filter((w) => w.label !== label)
        })

        openWindows.value.push(entry)
        return entry
      } catch (err) {
        console.error('[ConstructWindow] Tauri window creation failed, falling back:', err)
      }
    }

    // ── Browser fallback ────────────────────────────────────────────────
    const popup = window.open(url, label, buildPopupFeatures(options))
    const entry: ConstructWindow = {
      label,
      url,
      _tauriWindow: null,
      _browserWindow: popup,
    }
    openWindows.value.push(entry)
    return entry
  }

  /**
   * Navigate an existing window to a new URL.
   */
  async function navigate(win: ConstructWindow, url: string): Promise<void> {
    win.url = url

    if (win._tauriWindow && isTauriEnv()) {
      await close(win)
      await open(url, { label: win.label })
      return
    }

    if (win._browserWindow && !win._browserWindow.closed) {
      win._browserWindow.location.href = url
    }
  }

  /**
   * Focus an existing window.
   */
  async function focus(win: ConstructWindow): Promise<void> {
    if (win._tauriWindow && isTauriEnv()) {
      const tw = win._tauriWindow as { setFocus(): Promise<void> }
      await tw.setFocus()
      return
    }
    win._browserWindow?.focus()
  }

  /**
   * Close a window.
   */
  async function close(win: ConstructWindow): Promise<void> {
    if (win._tauriWindow && isTauriEnv()) {
      const tw = win._tauriWindow as { close(): Promise<void> }
      try {
        await tw.close()
      } catch { /* already closed */ }
    }

    if (win._browserWindow && !win._browserWindow.closed) {
      win._browserWindow.close()
    }

    openWindows.value = openWindows.value.filter((w) => w.label !== win.label)
  }

  /**
   * Close all tracked windows.
   */
  async function closeAll(): Promise<void> {
    const wins = [...openWindows.value]
    await Promise.all(wins.map((w) => close(w)))
  }

  /**
   * Get an open window by its label.
   */
  function getByLabel(label: string): ConstructWindow | undefined {
    return openWindows.value.find((w) => w.label === label)
  }

  /**
   * Set the always-on-top state.
   */
  async function setAlwaysOnTop(win: ConstructWindow, value: boolean): Promise<void> {
    if (win._tauriWindow && isTauriEnv()) {
      const tw = win._tauriWindow as { setAlwaysOnTop(v: boolean): Promise<void> }
      await tw.setAlwaysOnTop(value)
    }
  }

  /**
   * Set the window title.
   */
  async function setTitle(win: ConstructWindow, title: string): Promise<void> {
    if (win._tauriWindow && isTauriEnv()) {
      const tw = win._tauriWindow as { setTitle(t: string): Promise<void> }
      await tw.setTitle(title)
    }

    if (win._browserWindow && !win._browserWindow.closed) {
      win._browserWindow.document.title = title
    }
  }

  /**
   * Emit a custom event to a specific window by label (cross-window).
   */
  async function emit(win: ConstructWindow, event: string, data?: unknown): Promise<void> {
    if (win._tauriWindow && isTauriEnv()) {
      const tw = win._tauriWindow as { emitTo(target: string, e: string, d?: unknown): Promise<void> }
      await tw.emitTo(win.label, event, data)
    }
  }

  return {
    /** All tracked windows */
    windows: openWindows,
    open,
    navigate,
    focus,
    close,
    closeAll,
    getByLabel,
    setAlwaysOnTop,
    setTitle,
    emit,
  }
}

function buildPopupFeatures(opts: ConstructWindowOptions): string {
  const w = opts.width ?? 1200
  const h = opts.height ?? 820
  const left = Math.round((screen.width - w) / 2)
  const top = Math.round((screen.height - h) / 2)
  return `width=${w},height=${h},left=${left},top=${top},resizable=${opts.resizable !== false ? 'yes' : 'no'},menubar=no,toolbar=no,location=yes,status=no`
}
