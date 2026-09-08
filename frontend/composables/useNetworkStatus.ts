/**
 * useNetworkStatus — central place for "are we online?" plus the
 * helpers that keep the rest of the app from spamming errors when the
 * answer is no.
 *
 * Problems this solves:
 *  1. Dropping Wi-Fi mid-session would fire `fetchProfile` / scope /
 *     telemetry requests that all failed with "error sending request",
 *     each logging a full ERROR line and none of them helpful.
 *  2. Users had no indication the app had lost the network — they just
 *     saw features mysteriously stop working.
 *
 * This composable exposes:
 *  - `isOnline`: reactive boolean from `useOnline()` (vueuse auto-import).
 *  - `isNetworkError(err)`: heuristic for "this was the network, not
 *    the server". Matches the common shapes we see in the console:
 *    TypeError "Failed to fetch", reqwest "error sending request",
 *    generic "NetworkError", ERR_INTERNET_DISCONNECTED etc.
 *  - `reportNetworkError(err, source?)`: call from any failing request
 *    handler. If the error looks like a network drop, records it and
 *    fires at most one toast per offline window; otherwise no-ops.
 *  - `install()`: attach online/offline transition toasts. Call once
 *    from app bootstrap — repeat calls short-circuit.
 */

import { watch, type Ref } from 'vue'
import { notify } from '@/composables/useNotification'

// 15s de-duplication window: once an offline toast is shown we won't
// show another until the connection comes back or the window expires.
// Longer than the 5s toast duration so the user doesn't see the toast
// disappear and immediately reappear during retry storms.
const OFFLINE_TOAST_COOLDOWN_MS = 15_000

let lastOfflineToastAt = 0
let installed = false

export function isNetworkError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  // Browser fetch: TypeError "Failed to fetch" / "NetworkError when
  // attempting to fetch resource" (Firefox).
  if (lower.includes('failed to fetch')) return true
  if (lower.includes('networkerror')) return true
  // Rust reqwest (via Tauri `construct_auth_profile` and similar):
  // "error sending request for url (...)".
  if (lower.includes('error sending request')) return true
  // OS-level / Chrome network interruptions.
  if (lower.includes('err_internet_disconnected')) return true
  if (lower.includes('err_network_changed')) return true
  if (lower.includes('err_name_not_resolved')) return true
  if (lower.includes('econnrefused')) return true
  if (lower.includes('enotfound')) return true
  if (lower.includes('load failed')) return true // WebKit
  return false
}

export interface NetworkStatus {
  isOnline: Ref<boolean>
  isNetworkError: typeof isNetworkError
  reportNetworkError: (err: unknown, source?: string) => boolean
  install: () => void
}

export function useNetworkStatus(): NetworkStatus {
  // useOnline is vueuse (auto-imported via unplugin-auto-import —
  // declared in auto-imports.d.ts). Fallback to a manual ref if not
  // available so this composable is usable from tests.
  const isOnline = typeof useOnline === 'function'
    ? useOnline()
    : (() => {
        const online = ref(typeof navigator !== 'undefined' ? navigator.onLine !== false : true)
        if (typeof window !== 'undefined') {
          window.addEventListener('online', () => { online.value = true })
          window.addEventListener('offline', () => { online.value = false })
        }
        return online
      })()

  function reportNetworkError(err: unknown, source?: string): boolean {
    if (!isNetworkError(err) && isOnline.value) return false

    const now = Date.now()
    if (now - lastOfflineToastAt < OFFLINE_TOAST_COOLDOWN_MS) {
      return true // already notified; caller should still swallow the log
    }
    lastOfflineToastAt = now
    const title = isOnline.value ? 'Can’t reach the server' : 'No internet connection'
    const description = isOnline.value
      ? 'The network is up but the request failed. Retrying quietly in the background.'
      : source
        ? `Some features won’t work until you’re back online. (${source})`
        : 'Some features won’t work until you’re back online.'
    notify(title, 'warning', description)
    return true
  }

  function install() {
    if (installed) return
    installed = true
    // One-time transition toasts. Offline toasts are throttled by
    // reportNetworkError's cooldown so we only emit one here on the
    // actual transition, not per-failed-request.
    watch(isOnline, (online, prev) => {
      if (prev === online) return
      if (online) {
        notify('Back online', 'success', 'Network connection restored.')
        lastOfflineToastAt = 0 // reset so the next drop toasts immediately
      } else {
        lastOfflineToastAt = Date.now()
        notify('No internet connection', 'warning', 'Some features won’t work until you’re back online.')
      }
    })
  }

  return { isOnline, isNetworkError, reportNetworkError, install }
}
