/**
 * useLogger — Structured logging via @tauri-apps/plugin-log
 *
 * In Tauri: logs to disk with auto-rotation.
 * In browser: falls back to console.
 */

interface Logger {
  info: (message: string) => void | Promise<void>
  warn: (message: string) => void | Promise<void>
  error: (message: string) => void | Promise<void>
  debug: (message: string) => void | Promise<void>
}

let _logger: Logger | null = null
let _loggerPromise: Promise<Logger> | null = null

export async function getLogger(): Promise<Logger> {
  if (_logger) return _logger
  if (_loggerPromise) return _loggerPromise

  _loggerPromise = (async () => {
    try {
      const { info, warn, error, debug } = await import('@tauri-apps/plugin-log')
      _logger = { info, warn, error, debug }
      return _logger
    } catch {
      _logger = {
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console),
      }
      return _logger
    }
  })()

  return _loggerPromise
}
