/**
 * consoleToFile — mirror console.* output into the Tauri log file.
 *
 * Tauri writes plugin-log entries to:
 *   macOS   ~/Library/Logs/{bundleId}/construct.log
 *   Linux   ~/.config/{bundleId}/logs/construct.log
 *   Windows %LOCALAPPDATA%/{bundleId}/logs/construct.log
 *
 * Enables: `await installConsoleToFile()` once at startup.
 * Safe outside Tauri (no-op).
 */

import { isTauriEnv } from '@/utils/tauri'

let installed = false

export async function installConsoleToFile(prefix = ''): Promise<void> {
  if (installed) return
  if (!isTauriEnv()) return
  installed = true

  const { trace, debug, info, warn, error } = await import('@tauri-apps/plugin-log')

  const label = await resolveLabel()
  const tag = prefix || label || 'web'

  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  const fmt = (args: unknown[]) =>
    args
      .map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`
        if (typeof a === 'string') return a
        try { return JSON.stringify(a) } catch { return String(a) }
      })
      .join(' ')

  console.log = (...args: unknown[]) => { orig.log(...args); void info(`[${tag}] ${fmt(args)}`).catch(() => {}) }
  console.info = (...args: unknown[]) => { orig.info(...args); void info(`[${tag}] ${fmt(args)}`).catch(() => {}) }
  console.debug = (...args: unknown[]) => { orig.debug(...args); void debug(`[${tag}] ${fmt(args)}`).catch(() => {}) }
  console.warn = (...args: unknown[]) => { orig.warn(...args); void warn(`[${tag}] ${fmt(args)}`).catch(() => {}) }
  console.error = (...args: unknown[]) => { orig.error(...args); void error(`[${tag}] ${fmt(args)}`).catch(() => {}) }

  // Uncaught errors + promise rejections
  window.addEventListener('error', (e) => {
    void error(`[${tag}] uncaught: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`).catch(() => {})
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack}` : String(e.reason)
    void error(`[${tag}] unhandledrejection: ${reason}`).catch(() => {})
  })

  void trace(`[${tag}] consoleToFile installed`).catch(() => {})
}

async function resolveLabel(): Promise<string> {
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    return getCurrentWebviewWindow().label
  } catch {
    return ''
  }
}
