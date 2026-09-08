/**
 * useNotifications — desktop-app notification inbox + live stream.
 *
 * Realtime transport is owned by Rust (`desktop/src/notifications.rs`):
 * the worker holds the WS through the gateway to delivery-api, survives
 * webview reloads, runs while the window is hidden in tray, and re-emits
 * server frames as Tauri events. This composable just registers listeners,
 * fetches the inbox over REST, and exposes reactive state to the UI.
 *
 * Browser dev (vite dev server in a plain tab) gets the inbox via REST
 * polling only — no realtime channel — since notifications are a
 * desktop-app concern.
 *
 *   const notif = useNotifications()
 *   notif.start()           // call once per app session (after sign-in)
 *   notif.unread.value      // reactive count, drives the bell badge
 *   notif.items.value       // reactive list, newest-first
 *   await notif.markRead(id)
 */

import { ref, computed, watch } from 'vue'
import { appConfig } from '@/utils/config'
import { useAuthStore } from '@/stores/auth'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauriEnv } from '@/utils/tauri'
import { dispatchDeviceCommand, type DeviceCommandPayload } from './useDeviceBus'

export interface AppNotification {
  id: string
  source: string
  type: string
  title: string
  body: string
  link?: string
  data?: unknown
  read_at?: string | null
  created_at: string
}

export interface NotificationPreferences {
  in_app_enabled: boolean
  web_push_enabled: boolean
  mobile_enabled: boolean
  email_fallback: boolean
  muted_types?: string[]
  updated_at: string
}

export interface BridgeDebugState {
  connected: boolean
  has_token: boolean
  base_url: string | null
  last_connect_at_ms: number | null
  last_error: string | null
  retry_count: number
}

const items = ref<AppNotification[]>([])
const unread = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const debugState = ref<BridgeDebugState | null>(null)
let started = false
let osPermissionGranted = false
let pollTimer: ReturnType<typeof setInterval> | null = null
let debugPollTimer: ReturnType<typeof setInterval> | null = null
const POLL_INTERVAL_MS = 30_000
const DEBUG_POLL_INTERVAL_MS = 5_000

// Rust-bridge teardown handles. Set when the worker is carrying the
// stream so we can detach listeners on stop().
const tauriUnlisteners: UnlistenFn[] = []
let tauriBridgeActive = false
let lastTokenPushed: string | null = null

// Lazy permission request — only the first time an OS notification is
// about to fire, not at app boot. Result cached for the session.
async function ensureOsPermission(): Promise<boolean> {
  if (osPermissionGranted) return true
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === 'granted'
    osPermissionGranted = granted
    return granted
  } catch {
    return false
  }
}

async function maybeShowOsNotification(n: AppNotification): Promise<void> {
  // Only fires from the REST poll path. Realtime banners are handled
  // by the Rust worker (it fires the banner before emitting the Tauri
  // event so the in-app bell never races with the OS toast).
  try {
    const win = getCurrentWindow()
    if (await win.isFocused()) return
  } catch { /* fall through and notify anyway */ }
  if (!(await ensureOsPermission())) return
  try {
    sendNotification({ title: n.title, body: n.body || '' })
  } catch { /* best-effort */ }
}

// macOS dock badge mirrors unread count. Rust handles this on the
// realtime path; this watcher catches REST-only updates (poll, mark
// read/all) in tauri + non-tauri builds. setBadgeCount(0) clears it.
let osBridgeInit = false
function setupOsBridge() {
  if (osBridgeInit) return
  osBridgeInit = true
  watch(unread, (count) => {
    try {
      getCurrentWindow()
        .setBadgeCount(count > 0 ? count : undefined)
        .catch(() => { /* unsupported platform */ })
    } catch { /* not in tauri */ }
  }, { immediate: true })
}

function notificationsBase(): string {
  const base = appConfig.notificationsUrl || `${appConfig.gatewayUrl}/api/notifications`
  return base.replace(/\/$/, '')
}

function notificationsBridgeBase(): string {
  // Rust cannot use Vite's relative dev proxy, so it receives the absolute
  // gateway API root and appends /notifications/ws itself.
  const base = appConfig.notificationsBridgeUrl || `${appConfig.gatewayUrl}/api`
  return base.replace(/\/$/, '')
}

function buildHeaders(token: string | null, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    let msg = txt || `Request failed (${res.status})`
    try {
      const parsed = JSON.parse(txt) as { error?: string }
      if (parsed.error) msg = parsed.error
    } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

async function fetchInbox(): Promise<void> {
  const auth = useAuthStore()
  const token = auth.oauthToken || auth.token
  if (!token) return
  loading.value = true
  error.value = null
  try {
    const [list, count] = await Promise.all([
      fetch(`${notificationsBase()}?limit=50`, { headers: buildHeaders(token) })
        .then((r) => readJson<{ notifications: AppNotification[] }>(r)),
      fetch(`${notificationsBase()}/unread-count`, { headers: buildHeaders(token) })
        .then((r) => readJson<{ unread: number }>(r)),
    ])
    // Detect items that arrived since the last fetch so the poll path
    // can surface OS notifications too — Rust only fires the banner on
    // the realtime channel.
    const known = new Set(items.value.map((n) => n.id))
    const fresh = list.notifications.filter((n) => !known.has(n.id) && !n.read_at)
    items.value = list.notifications
    unread.value = count.unread
    // Skip on the very first fetch (known is empty) — those are catch-up
    // items, the user already missed them; nagging the OS for each is
    // worse than silent. Also skip if the realtime bridge is up — Rust
    // already showed the banner when the item first arrived.
    if (known.size > 0 && !tauriBridgeActive) {
      for (const n of fresh) maybeShowOsNotification(n)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
}

// ── Rust bridge (Tauri only) ──
//
// `desktop/src/notifications.rs` owns the WebSocket. We push the token
// in, listen for re-emitted events, and let the worker handle reconnect
// + OS banner + dock badge from native side.

async function startTauriBridge(token: string): Promise<boolean> {
  try {
    const baseUrl = notificationsBridgeBase()
    await invoke('notifications_set_token', { token, baseUrl })
    if (tauriBridgeActive) return true
    tauriBridgeActive = true
    lastTokenPushed = token
    tauriUnlisteners.push(
      await listen<AppNotification>('construct://notification', (e) => {
        const n = e.payload
        if (!n || typeof n !== 'object') return
        // Rust has already shown the OS banner if appropriate; we just
        // splice into the in-app inbox here.
        items.value = [n, ...items.value.filter((x) => x.id !== n.id)].slice(0, 50)
      }),
      await listen<number>('construct://unread-count', (e) => {
        if (typeof e.payload === 'number') unread.value = e.payload
      }),
      await listen<DeviceCommandPayload>('construct://device-command', (e) => {
        if (e.payload && typeof e.payload === 'object') {
          dispatchDeviceCommand(e.payload)
        }
      }),
    )
    startDebugPoll()
    return true
  } catch (e) {
    error.value = `tauri bridge unavailable: ${e instanceof Error ? e.message : e}`
    tauriBridgeActive = false
    return false
  }
}

async function refreshTauriToken(token: string | null): Promise<void> {
  if (!isTauriEnv()) return
  try {
    if (!token) {
      await invoke('notifications_clear_token')
      lastTokenPushed = null
      return
    }
    if (token === lastTokenPushed) return
    await invoke('notifications_set_token', { token, baseUrl: notificationsBridgeBase() })
    lastTokenPushed = token
  } catch { /* surface only on first start */ }
}

async function teardownTauriBridge(): Promise<void> {
  while (tauriUnlisteners.length) {
    const fn = tauriUnlisteners.pop()
    try { fn?.() } catch { /* ignore */ }
  }
  tauriBridgeActive = false
  if (debugPollTimer) { clearInterval(debugPollTimer); debugPollTimer = null }
  debugState.value = null
  if (isTauriEnv()) {
    try { await invoke('notifications_clear_token') } catch { /* ignore */ }
  }
  lastTokenPushed = null
}

function startDebugPoll() {
  if (debugPollTimer) return
  const tick = async () => {
    try {
      debugState.value = await invoke<BridgeDebugState>('notifications_debug_state')
    } catch { /* command absent — drop debug ref */ debugState.value = null }
  }
  tick()
  debugPollTimer = setInterval(tick, DEBUG_POLL_INTERVAL_MS)
}

async function start() {
  if (started) return
  started = true
  setupOsBridge()
  fetchInbox()

  const auth = useAuthStore()
  const token = auth.oauthToken || auth.token
  if (isTauriEnv() && token) {
    await startTauriBridge(token)
  }

  // Keep Rust's token in sync if the auth store rotates it later.
  watch(
    () => auth.oauthToken || auth.token,
    (next) => { refreshTauriToken(next) },
  )

  // Poll fallback — keeps the bell badge honest if the realtime channel
  // stalls between Rust reconnect cycles. Also the only update path in
  // browser dev where there is no Rust worker.
  pollTimer = setInterval(() => { fetchInbox() }, POLL_INTERVAL_MS)
}

async function stop() {
  started = false
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  await teardownTauriBridge()
}

async function markRead(id: string): Promise<void> {
  const auth = useAuthStore()
  const token = auth.oauthToken || auth.token
  if (!token) return
  // Optimistic
  const idx = items.value.findIndex((n) => n.id === id)
  if (idx >= 0 && !items.value[idx].read_at) {
    items.value[idx] = { ...items.value[idx], read_at: new Date().toISOString() }
    unread.value = Math.max(0, unread.value - 1)
  }
  await fetch(`${notificationsBase()}/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: buildHeaders(token),
  }).catch(() => { /* server-side will resync on next fetch */ })
}

async function markAllRead(): Promise<void> {
  const auth = useAuthStore()
  const token = auth.oauthToken || auth.token
  if (!token) return
  const prev = unread.value
  unread.value = 0
  items.value = items.value.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
  try {
    await fetch(`${notificationsBase()}/read-all`, { method: 'POST', headers: buildHeaders(token) })
  } catch {
    unread.value = prev // best-effort revert
  }
}

async function dismiss(id: string): Promise<void> {
  const auth = useAuthStore()
  const token = auth.oauthToken || auth.token
  if (!token) return
  const idx = items.value.findIndex((n) => n.id === id)
  if (idx < 0) return
  const removed = items.value[idx]
  items.value = items.value.filter((n) => n.id !== id)
  if (!removed.read_at) unread.value = Math.max(0, unread.value - 1)
  await fetch(`${notificationsBase()}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: buildHeaders(token),
  }).catch(() => { /* server-side will resync on next fetch */ })
}

export function useNotifications() {
  return {
    items: computed(() => items.value),
    unread: computed(() => unread.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    debugState: computed(() => debugState.value),
    bridgeActive: computed(() => tauriBridgeActive),
    start,
    stop,
    refresh: fetchInbox,
    markRead,
    markAllRead,
    dismiss,
  }
}
