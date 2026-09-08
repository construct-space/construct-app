/**
 * useSourceDeviceBus — subscribes to source-api's /api/device-bus/ws and
 * routes inbound envelopes into the existing dispatchDeviceCommand
 * pipeline. Lets the desktop receive assistant.ask + scheduler.claim_now
 * events from source's hub (the destination after the 2026-05-20
 * migration off delivery).
 *
 * Notifications (delivery WS) keep their separate path — they're a
 * different service (delivery-api) and a different envelope shape.
 * This composable handles only the device-bus traffic.
 *
 * The Rust-side notifications.rs holds the delivery WS for resilience
 * across webview reloads. For now this composable runs in the JS layer
 * (simpler); a follow-up can mirror the same pattern into Rust if
 * webview-reload drops become an issue for the device-bus too.
 */

import { useAuthStore } from '@/stores/auth'
import { dispatchDeviceCommand, type DeviceCommandPayload } from '@/composables/useDeviceBus'
import { sourceDeviceBusOperatorStatusUrl, sourceDeviceBusRelayUrl, sourceDeviceBusWsUrl } from '@/utils/deviceBus'
import { isTauriEnv } from '@/utils/tauri'

interface BusEnvelope {
  type?: string
  from?: string
  payload?: unknown
}

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelayMs = 1000
let connId: string | null = null
let started = false

/**
 * Idempotent. Call once after auth is ready (main.ts boot path).
 * Manages reconnect on its own; the WS reconnects with exponential
 * backoff up to 30s.
 */
export function startSourceDeviceBus(): void {
  if (started) return
  started = true
  console.log('[deviceBus] startSourceDeviceBus invoked')
  connect()
  // Fire any notification tasks already due at launch without waiting for the
  // next server tick (the server re-pushes every 5s, but this is snappier and
  // covers wakes the server deduped while no device was connected).
  void catchUpDueNotifications()
}

// ── Scheduled notification runner (app-level) ───────────────────────────────
// The shape of a "notification" scheduled action. Any space can schedule one;
// the host fires it app-wide so it doesn't depend on the owning space's page
// being mounted.
interface ScheduledNotify {
  title: string
  body?: string
  type?: string
  source?: string
  sound?: boolean
}

interface ClaimNowPayload {
  task_id?: string
  owner_space?: string
  scheduled_for?: string
  action?: { notify?: ScheduledNotify } & Record<string, unknown>
}

/** Stable per-install id so concurrent devices don't double-claim a fire. */
function schedulerDeviceId(): string {
  try {
    let id = localStorage.getItem('construct:scheduler_device_id')
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`
      localStorage.setItem('construct:scheduler_device_id', id)
    }
    return id
  } catch {
    return 'construct-device'
  }
}

/** Minute-granular dedup key matching the Rust local scheduler's `fire_key`
 *  (floor(scheduledForUnix / 60)) so the two paths never double-ring. */
function fireKeyFor(scheduledFor?: string): string {
  const ms = scheduledFor ? Date.parse(scheduledFor) : NaN
  const unix = Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000)
  return String(Math.floor(unix / 60))
}

// Two delivery surfaces, deduped per occurrence:
//   - This online runner (app alive) shows a durable self-notification (bell +
//     push) the moment the task is due (~5s after, via the device bus).
//   - The Rust local scheduler (desktop/src/local_alarms.rs) covers
//     closed-to-tray / offline / fully-quit with a native OS banner.
// `local_alarms_try_fire` is the shared atomic gate: whichever path claims the
// occurrence first rings it; the other stands down. Online + app-alive almost
// always wins here (the bus beats Rust's 30s tick), so the bell entry is the
// usual surface and Rust is the resilient fallback. On web (no Rust) we always
// ring. Either way the runner still claims + reports so `next_run_at` advances,
// the notifier stops re-pushing, and other devices see it handled.
async function shouldRingHere(taskId: string, scheduledFor?: string): Promise<boolean> {
  if (!isTauriEnv()) return true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<boolean>('local_alarms_try_fire', { taskId, fireKey: fireKeyFor(scheduledFor) })
  } catch {
    return true // native dedup unavailable — prefer ringing over silence
  }
}

async function advanceScheduledNotify(
  taskId: string,
  notify?: ScheduledNotify,
  scheduledFor?: string,
): Promise<void> {
  const { useScheduler } = await import('@/composables/useScheduler')
  const scheduler = useScheduler()
  const deviceId = schedulerDeviceId()
  try {
    await scheduler.claim(taskId, { deviceId })
  } catch {
    // Lost the race (another device/conn claimed) or no longer due.
    return
  }
  if (notify?.title && (await shouldRingHere(taskId, scheduledFor))) {
    // Audible alert when the task asked for sound. The OS-notification sound is
    // unreliable, so play a Web Audio chime app-wide; this is the path the
    // native Rust ring is suppressed in favor of while the app is alive.
    if (notify.sound) {
      try {
        const { playNotifySound } = await import('@/utils/notifySound')
        playNotifySound()
      } catch { /* ignore */ }
    }
    try {
      const { useNotification } = await import('@/composables/useNotification')
      await useNotification().send({
        title: notify.title,
        body: notify.body,
        type: notify.type || 'scheduled.notify',
        source: notify.source || 'scheduler',
      })
    } catch (err) {
      console.error('[deviceBus] self-notify failed:', err)
    }
  }
  try {
    await scheduler.report(taskId, { deviceId, outcome: 'success' })
  } catch (err) {
    console.error('[deviceBus] scheduler report failed:', err)
  }
}

function handleScheduledNotify(payload: unknown): Promise<void> {
  const p = payload as ClaimNowPayload | undefined
  const notify = p?.action?.notify
  // No notify block → not a host-fireable notification; the owning space's
  // onFire handler owns this task. Leave it alone.
  if (!p?.task_id || !notify || !notify.title) return Promise.resolve()
  return advanceScheduledNotify(p.task_id, notify, p.scheduled_for)
}

async function catchUpDueNotifications(): Promise<void> {
  try {
    const auth = useAuthStore()
    if (!auth.token) return
    const { useScheduler } = await import('@/composables/useScheduler')
    const due = await useScheduler().list({ due: true })
    for (const task of due) {
      const notify = (task.action as { notify?: ScheduledNotify } | undefined)?.notify
      if (notify?.title) await advanceScheduledNotify(task.id, notify, task.nextRunAt)
    }
  } catch (err) {
    console.error('[deviceBus] due-notification catch-up failed:', err)
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }
  const auth = useAuthStore()
  const token = auth.token
  if (!token) {
    console.log('[deviceBus] auth token not ready, retrying soon')
    scheduleReconnect()
    return
  }
  const url = sourceDeviceBusWsUrl(token)
  console.log('[deviceBus] connecting:', url.replace(/token=[^&]+/, 'token=***'))
  let opened = false
  try {
    ws = new WebSocket(url)
  } catch (err) {
    console.error('[deviceBus] WebSocket constructor threw:', err)
    scheduleReconnect()
    return
  }
  ws.onopen = () => {
    opened = true
    console.log('[deviceBus] connected, registering as operator')
    reconnectDelayMs = 1000
    try {
      ws?.send(JSON.stringify({ type: 'register', kind: 'operator' }))
    } catch (err) {
      console.error('[deviceBus] register send failed:', err)
    }
  }
  ws.onmessage = (ev) => {
    let env: BusEnvelope
    try {
      env = JSON.parse(ev.data) as BusEnvelope
    } catch {
      return
    }
    if (env.type === 'hello' && typeof (env as { conn_id?: string }).conn_id === 'string') {
      connId = (env as { conn_id?: string }).conn_id ?? null
      return
    }
    // assistant.ask / assistant.chunk / assistant.complete reuse the
    // existing dispatchDeviceCommand pipeline. The legacy delivery
    // envelope nests these under a `command` key; source emits them
    // flat. We adapt at this boundary so dispatchDeviceCommand stays
    // unchanged.
    if (typeof env.type === 'string' && env.type.startsWith('assistant.')) {
      const cmd: DeviceCommandPayload = {
        cmd: env.type,
        from: env.from,
        payload: env.payload,
      }
      try { dispatchDeviceCommand(cmd) } catch (err) { console.error('[deviceBus] dispatch error', err) }
      return
    }
    // scheduler.claim_now: notification-class tasks (action.notify present)
    // are fired here at the app level — so a scheduled notification (e.g. a
    // clock alarm) rings whenever the app is open, regardless of which space
    // is mounted. Non-notify tasks are left for their owning space's
    // useScheduler().onFire handler (which has its own WS subscription).
    if (env.type === 'scheduler.claim_now') {
      void handleScheduledNotify(env.payload)
      return
    }
  }
  ws.onclose = (ev) => {
    console.log('[deviceBus] closed:', ev.code, ev.reason || '(no reason)')
    if (!opened && ev.code === 1006) {
      void diagnoseHandshakeDrop(token)
    }
    ws = null
    scheduleReconnect()
  }
  ws.onerror = (ev) => {
    console.error('[deviceBus] error:', ev)
  }
}

async function diagnoseHandshakeDrop(token: string): Promise<void> {
  try {
    const res = await fetch(sourceDeviceBusOperatorStatusUrl(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      console.warn('[deviceBus] handshake dropped before open; auth/status endpoint is healthy, reconnecting')
      return
    }
    console.warn('[deviceBus] handshake dropped before open; status probe failed:', res.status)
  } catch (err) {
    console.warn('[deviceBus] handshake dropped before open; status probe failed:', err)
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000)
    connect()
  }, reconnectDelayMs)
}

/**
 * Publish an envelope to source's relay. Used by brain (or the UI)
 * to send assistant.chunk / assistant.complete back to the asking
 * device. Uses X-Sender-Conn-Id so the publishing device doesn't
 * receive its own envelope back as a no-op event.
 */
export async function publishToSourceBus(env: BusEnvelope): Promise<void> {
  const auth = useAuthStore()
  if (!auth.token) throw new Error('not authenticated')
  const url = sourceDeviceBusRelayUrl()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.token}`,
      ...(connId ? { 'X-Sender-Conn-Id': connId } : {}),
    },
    body: JSON.stringify(env),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`relay publish failed: ${res.status} ${txt}`)
  }
}
