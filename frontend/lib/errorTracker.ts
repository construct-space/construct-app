/**
 * Global error capture → telemetry.
 *
 * Hooks app.config.errorHandler (Vue render errors), window.onerror (sync
 * runtime errors), and window.onunhandledrejection (async rejections).
 * Each is mapped to a stable, low-cardinality class string forwarded to
 * trackErrorClass(), AND — when telemetry is enabled — a detail event with
 * message + stack via trackErrorEvent(). Both are consent-gated; the detail
 * payload has home paths and secret tokens redacted and is length-capped in
 * useTelemetry (redactSecrets + sanitizeStack) before it ever leaves the
 * device.
 *
 * Class taxonomy is the Error subtype name normalized to snake_case
 * (TypeError → type_error, ReferenceError → reference_error). Vue render
 * errors get a vue.<component?> prefix when we can identify the source.
 * Unrecognized shapes fall back to "runtime" so the cardinality stays
 * bounded — a class column in a database is no place for unique stacks.
 */
import type { App } from 'vue'

let installed = false

function classify(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name || 'Error'
    return name
      .replace(/Error$/, '_error')
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/^_+|_+$/g, '')
      || 'runtime'
  }
  return 'runtime'
}

// Pull a short, low-cardinality source hint from a stack frame or filename
// so a class like `not_supported_error` becomes `not_supported_error.toolbar3d`
// instead of an opaque bucket. We strip Vite's content-hash suffix
// (`Toolbar3D-abc123.js` → `toolbar3d`) so prod builds don't blow up the
// dimension on every release.
const HASH_SUFFIX_RE = /-[A-Za-z0-9_]{6,}$/
const SOURCE_RE = /\/([\w.-]+)\.(?:[mc]?[jt]sx?|vue)(?:[?#].*)?(?::\d+)?(?::\d+)?/i

function sourceFromFilename(filename: string | undefined | null): string | null {
  if (!filename) return null
  const match = filename.match(SOURCE_RE)
  if (!match) return null
  return match[1].replace(HASH_SUFFIX_RE, '').toLowerCase()
}

function sourceFromStack(stack: string | undefined | null): string | null {
  if (!stack) return null
  for (const line of stack.split('\n')) {
    const tag = sourceFromFilename(line)
    if (tag && tag !== 'index' && tag !== 'errortracker') return tag
  }
  return null
}

function classifyWithSource(err: unknown, fallbackFilename?: string | null): string {
  const cls = classify(err)
  const source = (err instanceof Error && sourceFromStack(err.stack))
    || sourceFromFilename(fallbackFilename || null)
  return source ? `${cls}.${source}` : cls
}

async function emit(errorClass: string, full?: { error: unknown, source?: string }): Promise<void> {
  try {
    const { useTelemetry, trackErrorEvent } = await import('@/composables/useTelemetry')
    await useTelemetry().trackErrorClass(errorClass)
    if (full && full.error instanceof Error) {
      await trackErrorEvent({
        errorClass,
        message: full.error.message,
        stack: full.error.stack || '',
        source: full.source || 'frontend',
      })
    }
  } catch {
    // Telemetry must never break the app.
  }
}

/**
 * Install the global handlers. Idempotent — safe to call from boot path.
 * Pass the Vue app so we can hook errorHandler too; without it we still
 * catch raw window-level errors but lose Vue render details.
 */
export function installErrorTracker(app?: App): void {
  if (installed) return
  installed = true

  if (app) {
    const prev = app.config.errorHandler
    app.config.errorHandler = (err, instance, info) => {
      const componentName = instance?.$options?.name || instance?.$options?.__name
      const cls = componentName
        ? `vue.${classify(err)}.${String(componentName).toLowerCase()}`
        : `vue.${classify(err)}`
      void emit(cls, { error: err })
      // Preserve any caller-supplied handler (Pinia + plugins sometimes set one).
      if (typeof prev === 'function') prev(err, instance, info)
      else if (import.meta.env.DEV) console.error('[errorTracker] vue:', err, info)
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      void emit(classifyWithSource(e.error ?? e, e.filename), { error: e.error ?? e })
    })
    window.addEventListener('unhandledrejection', (e) => {
      void emit(classifyWithSource(e.reason), { error: e.reason })
    })
  }
}
