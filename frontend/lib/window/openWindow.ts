import { isTauriEnv } from '@/utils/tauri'
import {
  hasHandoff,
  registeredSpaces,
  HandoffNotRegisteredError,
} from '@/lib/crossWindow/handoffRegistry'

export type WindowSpec =
  | { type: 'space-preview'; spaceId: string; projectPath?: string; width?: number; height?: number }
  | { type: 'web-preview'; url: string; device?: WebPreviewDevice; width?: number; height?: number; title?: string }
  | { type: 'detach-space'; spaceId: string; sessionId: string; project?: string }
  | { type: 'detach-assistant'; sessionId: string }
  | { type: 'browser'; url?: string; title?: string }

export type WebPreviewDevice = 'mobile' | 'tablet' | 'desktop' | 'custom'

// Device presets for web previews. Exposed so callers that need the
// exact dims (e.g. a side-by-side responsive grid) can read them without
// re-deriving from the enum.
export const WEB_PREVIEW_DEVICES: Record<Exclude<WebPreviewDevice, 'custom'>, { width: number; height: number }> = {
  mobile:  { width: 375,  height: 812 },
  tablet:  { width: 820,  height: 1180 },
  desktop: { width: 1440, height: 900 },
}

/**
 * Stable short hash for a URL so labels are dedup-able per URL+device.
 * Not cryptographic — collision-resistant enough for the label namespace.
 */
function hashUrl(url: string): string {
  let h = 2166136261
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export interface ConstructWindowHandle {
  label: string
  type: WindowSpec['type']
  focus(): Promise<void>
  close(): Promise<void>
  emit(event: string, payload?: unknown): Promise<void>
}

export interface ResolvedSpec {
  label: string
  url: string
  width: number
  height: number
  title: string
  focusExistingBy: 'spaceId' | 'sessionId' | null
}

const ALLOWED_BROWSER_PROTOCOLS = new Set(['http:', 'https:'])

function normalizeBrowserUrl(raw: string): string {
  const s = raw.trim()
  if (/^[a-z]+:\/\//i.test(s)) return s
  return `https://${s}`
}

function buildBrowserShellUrl(spec: { url?: string; title?: string }): string {
  const params = new URLSearchParams({ mode: 'browser' })
  if (spec.url) params.set('url', normalizeBrowserUrl(spec.url))
  if (spec.title?.trim()) params.set('title', spec.title.trim())
  return `/browser.html?${params.toString()}`
}

let nonceCounter = 0
function nextNonce(): string {
  nonceCounter++
  return `${Date.now().toString(36)}-${nonceCounter}`
}

export function resolveSpec(spec: WindowSpec): ResolvedSpec {
  switch (spec.type) {
    case 'space-preview': {
      const label = `preview-${spec.spaceId}`
      const dir = spec.projectPath ? `?dir=${encodeURIComponent(spec.projectPath)}` : ''
      return {
        label,
        url: `/#/preview/${spec.spaceId}${dir}`,
        width: spec.width ?? 1100,
        height: spec.height ?? 750,
        title: `Preview — ${spec.spaceId}`,
        focusExistingBy: 'spaceId',
      }
    }
    case 'web-preview': {
      const device = spec.device ?? 'desktop'
      const preset = device !== 'custom' ? WEB_PREVIEW_DEVICES[device] : null
      const width  = spec.width  ?? preset?.width  ?? 1440
      const height = spec.height ?? preset?.height ?? 900
      const label = `preview-web-${device}-${hashUrl(spec.url)}`
      const q = new URLSearchParams({ url: spec.url, device })
      if (spec.title) q.set('title', spec.title)
      return {
        label,
        url: `/#/preview-web?${q.toString()}`,
        width,
        height,
        title: spec.title ?? `${device[0].toUpperCase()}${device.slice(1)} — ${spec.url}`,
        // Reuse existing window on same URL+device; the shell HMR-reloads
        // instead of spawning duplicates.
        focusExistingBy: 'spaceId',
      }
    }
    case 'detach-space': {
      const label = `detach-space-${spec.spaceId}-${nextNonce()}`
      const proj = spec.project ? `&project=${encodeURIComponent(spec.project)}` : ''
      return {
        label,
        url: `/#/detach/space/${spec.spaceId}?session=${encodeURIComponent(spec.sessionId)}${proj}`,
        width: 1200,
        height: 820,
        title: spec.spaceId,
        focusExistingBy: 'sessionId',
      }
    }
    case 'detach-assistant': {
      const label = `detach-assistant-${nextNonce()}`
      return {
        label,
        url: `/#/detach/assistant?session=${encodeURIComponent(spec.sessionId)}`,
        width: 480,
        height: 700,
        title: 'Operator',
        focusExistingBy: 'sessionId',
      }
    }
    case 'browser': {
      const label = `browser-${nextNonce()}`
      return {
        label,
        url: buildBrowserShellUrl(spec),
        width: 1200,
        height: 820,
        title: spec.title ?? 'Construct Browser',
        focusExistingBy: null,
      }
    }
  }
}

export function validateSpec(spec: WindowSpec): void {
  if (spec.type === 'detach-space') {
    if (!hasHandoff(spec.spaceId)) {
      throw new HandoffNotRegisteredError(spec.spaceId, registeredSpaces())
    }
    return
  }
  if (spec.type === 'detach-assistant') {
    if (!hasHandoff('assistant')) {
      throw new HandoffNotRegisteredError('assistant', registeredSpaces())
    }
    return
  }
  if (spec.type === 'browser') {
    const target = spec.url
    if (target === undefined) return
    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      throw new Error(`Invalid browser URL: ${target}`)
    }
    if (!ALLOWED_BROWSER_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(
        `Disallowed browser protocol '${parsed.protocol}' — allowed: ${[...ALLOWED_BROWSER_PROTOCOLS].join(', ')}`,
      )
    }
  }
  if (spec.type === 'web-preview') {
    // Accept http/https for dev servers, file:// for built static assets,
    // and relative paths (resolved to file:// by the shell). No data: URLs
    // — those would bypass the child-webview value proposition.
    const t = spec.url.trim()
    if (!t) throw new Error('web-preview requires a url')
    if (/^data:/i.test(t)) {
      throw new Error('web-preview does not accept data: URLs — pass an http(s) or file:// URL')
    }
  }
}

export async function openWindow(spec: WindowSpec): Promise<ConstructWindowHandle> {
  validateSpec(spec)
  const resolved = resolveSpec(spec)

  if (isTauriEnv()) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')

    if (resolved.focusExistingBy === 'spaceId') {
      const existing = await WebviewWindow.getByLabel(resolved.label)
      if (existing) {
        await existing.setFocus()
        // HMR reload: re-opening a preview with the same label should
        // refresh the content instead of being a no-op. The shell listens
        // for `preview:reload` and either reloads the child webview (web)
        // or re-fetches the IIFE (space).
        if (spec.type === 'web-preview' || spec.type === 'space-preview') {
          try {
            const { emitTo } = await import('@tauri-apps/api/event')
            const payload = spec.type === 'web-preview' ? { url: spec.url } : {}
            await emitTo(resolved.label, 'preview:reload', payload)
          } catch { /* best-effort */ }
        }
        return wrap(resolved.label, spec.type, existing)
      }
    }

    const win = new WebviewWindow(resolved.label, {
      url: resolved.url,
      title: resolved.title,
      width: resolved.width,
      height: resolved.height,
      center: true,
      decorations: true,
      resizable: true,
      minimizable: true,
      maximizable: true,
      closable: true,
    })

    return wrap(resolved.label, spec.type, win)
  }

  if (spec.type !== 'browser' && spec.type !== 'space-preview') {
    throw new Error(`Window type '${spec.type}' is not supported outside Tauri`)
  }

  const popup = window.open(
    resolved.url,
    resolved.label,
    `width=${resolved.width},height=${resolved.height},resizable=yes,menubar=no,toolbar=no`,
  )
  return {
    label: resolved.label,
    type: spec.type,
    focus: async () => { popup?.focus() },
    close: async () => { popup?.close() },
    emit: async () => { /* no-op in browser */ },
  }
}

interface TauriWindowLike {
  setFocus(): Promise<void>
  close(): Promise<void>
  emit?(event: string, payload?: unknown): Promise<void>
}

function wrap(label: string, type: WindowSpec['type'], win: TauriWindowLike): ConstructWindowHandle {
  return {
    label,
    type,
    focus: () => win.setFocus(),
    close: () => win.close(),
    emit: async (event: string, payload?: unknown) => {
      if (typeof win.emit === 'function') await win.emit(event, payload)
    },
  }
}

// ── Unified preview API ──
// One entry point for every preview flavour. `target` + typed opts =
// predictable call site; dedup + HMR reload live in openWindow so callers
// don't have to think about "is this window already open?"

export type PreviewOpts =
  | { type: 'space'; width?: number; height?: number; projectPath?: string }
  | { type: 'web';   width?: number; height?: number; device?: WebPreviewDevice; title?: string }

export async function openPreview(target: string, opts: PreviewOpts): Promise<ConstructWindowHandle> {
  if (opts.type === 'space') {
    return openWindow({
      type: 'space-preview',
      spaceId: target,
      projectPath: opts.projectPath,
      width: opts.width,
      height: opts.height,
    })
  }
  return openWindow({
    type: 'web-preview',
    url: target,
    device: opts.device,
    width: opts.width,
    height: opts.height,
    title: opts.title,
  })
}

/**
 * Fan out a web URL into three device-sized preview windows (mobile +
 * tablet + desktop). Cascade-positioning is left to the OS; each window
 * gets its own dedup label so repeated calls reload in place instead of
 * piling on more windows.
 */
export async function openResponsivePreview(url: string): Promise<ConstructWindowHandle[]> {
  const devices: Exclude<WebPreviewDevice, 'custom'>[] = ['mobile', 'tablet', 'desktop']
  return Promise.all(devices.map(device => openPreview(url, { type: 'web', device })))
}
