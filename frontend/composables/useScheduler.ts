/**
 * useScheduler — host implementation of @construct-space/sdk's
 * `useScheduler()` composable. Wraps api/source's /api/scheduler/*
 * endpoints and the /api/device-bus/ws push channel for live wake
 * events.
 *
 * Spaces import `useScheduler` from `@construct-space/sdk`; this file
 * is what runs when they do (registered in lib/constructSdk.ts).
 *
 * Settings → Automations (host UI, host authority) is the only caller
 * that needs cross-space visibility; it can call this composable too
 * but is expected to manage its own filtering.
 *
 * Plan: construct-app/docs/plans/2026-05-20-automations.md
 */

import { appConfig } from '@/utils/config'
import { useAuthStore } from '@/stores/auth'
import { sourceDeviceBusWsUrl } from '@/utils/deviceBus'
import type {
  Scheduler,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskUpdate,
  ScheduledTaskListInput,
  ScheduledClaim,
  ScheduledClaimInput,
  ScheduledReportInput,
  ScheduledFireEvent,
  Unsubscribe,
} from '@construct-space/sdk'

// ─── Wire shape (snake_case) vs SDK shape (camelCase) helpers ──────────

interface WireTask {
  id: string
  owner_kind: 'user' | 'org' | 'system'
  owner_id: string
  owner_space: string
  owner_entity_id?: string
  title: string
  schedule: ScheduledTask['schedule']
  action: ScheduledTask['action']
  enabled: boolean
  next_run_at?: string
  state?: Record<string, unknown>
  created_at: string
  updated_at: string
}

function wireToTask(w: WireTask): ScheduledTask {
  return {
    id: w.id,
    ownerKind: w.owner_kind,
    ownerId: w.owner_id,
    ownerSpace: w.owner_space,
    ownerEntityId: w.owner_entity_id,
    title: w.title,
    schedule: w.schedule,
    action: w.action,
    enabled: w.enabled,
    nextRunAt: w.next_run_at,
    state: w.state,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
  }
}

function taskInputToWire(input: ScheduledTaskInput | ScheduledTaskUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('ownerSpace' in input && input.ownerSpace !== undefined) out.owner_space = input.ownerSpace
  if ('ownerEntityId' in input && input.ownerEntityId !== undefined) out.owner_entity_id = input.ownerEntityId
  if (input.title !== undefined) out.title = input.title
  if (input.schedule !== undefined) out.schedule = input.schedule
  if (input.action !== undefined) out.action = input.action
  if (input.enabled !== undefined) out.enabled = input.enabled
  if (input.nextRunAt !== undefined) out.next_run_at = input.nextRunAt
  return out
}

// ─── Single shared WS for scheduler.claim_now (and future event types) ─

// Fired after any task mutation (create/update/cancel) so the local alarm
// sync re-pushes the task set to the Rust scheduler immediately, instead of
// waiting up to 60s for its interval. Without this, a short timer started in
// a space and then left behind (page unmounted) can miss its 120s fire window.
export const SCHEDULER_CHANGED_EVENT = 'construct:scheduler-changed'
function notifyTasksChanged(): void {
  try { window.dispatchEvent(new Event(SCHEDULER_CHANGED_EVENT)) } catch { /* SSR / no window */ }
}

interface FireHandler {
  ownerSpace: string
  fn: (event: ScheduledFireEvent) => void
}

const handlers: Set<FireHandler> = new Set()
let ws: WebSocket | null = null
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
let wsReconnectDelayMs = 1000

function ensureBus(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }
  const auth = useAuthStore()
  if (!auth.token) return
  const url = sourceDeviceBusWsUrl(auth.token)
  try {
    ws = new WebSocket(url)
  } catch {
    scheduleReconnect()
    return
  }
  ws.onopen = () => { wsReconnectDelayMs = 1000 }
  ws.onmessage = (ev) => {
    try {
      const env = JSON.parse(ev.data) as { type?: string; payload?: unknown }
      if (env.type !== 'scheduler.claim_now') return
      const p = env.payload as {
        task_id: string
        owner_space: string
        scheduled_for: string
        action: ScheduledTask['action']
      }
      const event: ScheduledFireEvent = {
        taskId: p.task_id,
        ownerSpace: p.owner_space,
        scheduledFor: p.scheduled_for,
        action: p.action,
      }
      for (const h of handlers) {
        if (h.ownerSpace === event.ownerSpace) {
          try { h.fn(event) } catch (err) { console.error('[scheduler] fire handler error', err) }
        }
      }
    } catch {
      // Ignore malformed frames (hello/ping/etc).
    }
  }
  ws.onclose = () => { ws = null; if (handlers.size > 0) scheduleReconnect() }
  ws.onerror = () => { /* close fires after */ }
}

function scheduleReconnect(): void {
  if (wsReconnectTimer) return
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null
    wsReconnectDelayMs = Math.min(wsReconnectDelayMs * 2, 30_000)
    ensureBus()
  }, wsReconnectDelayMs)
}

function maybeCloseBus(): void {
  if (handlers.size === 0 && ws) {
    try { ws.close() } catch { /* noop */ }
    ws = null
  }
}

// ─── HTTP helpers ──────────────────────────────────────────────────────

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function readError(res: Response): Promise<string> {
  const txt = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(txt) as { error?: string }
    return parsed.error || `Request failed (${res.status})`
  } catch {
    return txt || `Request failed (${res.status})`
  }
}

class SchedulerError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message)
  }
}

// ─── Public composable ─────────────────────────────────────────────────

export function useScheduler(): Scheduler {
  const auth = useAuthStore()
  const base = appConfig.sourceUrl.replace(/\/$/, '')

  async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}/scheduler${path}`, {
      method,
      headers: authHeaders(auth.token),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const msg = await readError(res)
      const code = res.status === 409
        ? 'already_claimed'
        : res.status === 403
          ? 'forbidden'
          : res.status === 404
            ? 'not_found'
            : 'request_failed'
      throw new SchedulerError(msg, code, res.status)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async function create(input: ScheduledTaskInput): Promise<ScheduledTask> {
    const w = await http<WireTask>('POST', '/tasks', taskInputToWire(input))
    notifyTasksChanged()
    return wireToTask(w)
  }

  async function list(filter?: ScheduledTaskListInput): Promise<ScheduledTask[]> {
    const params = new URLSearchParams()
    if (filter?.ownerSpace) params.set('owner_space', filter.ownerSpace)
    if (filter?.ownerEntityId) params.set('owner_entity_id', filter.ownerEntityId)
    if (filter?.enabled !== undefined) params.set('enabled', filter.enabled ? 'true' : 'false')
    if (filter?.due) params.set('due', 'true')
    const qs = params.toString()
    const res = await http<{ tasks: WireTask[] }>('GET', qs ? `/tasks?${qs}` : '/tasks')
    return (res.tasks || []).map(wireToTask)
  }

  async function get(id: string): Promise<ScheduledTask> {
    const w = await http<WireTask>('GET', `/tasks/${encodeURIComponent(id)}`)
    return wireToTask(w)
  }

  async function update(id: string, patch: ScheduledTaskUpdate): Promise<ScheduledTask> {
    const w = await http<WireTask>('PATCH', `/tasks/${encodeURIComponent(id)}`, taskInputToWire(patch))
    notifyTasksChanged()
    return wireToTask(w)
  }

  async function toggle(id: string, enabled: boolean): Promise<ScheduledTask> {
    return update(id, { enabled })
  }

  async function cancel(id: string): Promise<void> {
    await http<void>('DELETE', `/tasks/${encodeURIComponent(id)}`)
    notifyTasksChanged()
  }

  async function runNow(id: string): Promise<ScheduledTask> {
    // No dedicated endpoint yet (deferred — see automations plan); shortcut
    // is to PATCH next_run_at to now. The next notify tick (≤5s) fires it.
    return update(id, { nextRunAt: new Date().toISOString() })
  }

  async function claim(id: string, input: ScheduledClaimInput): Promise<ScheduledClaim> {
    const r = await http<{ task_id: string; scheduled_for: string; expires_at: string }>(
      'POST', `/tasks/${encodeURIComponent(id)}/claim`,
      { device_id: input.deviceId, scheduled_for: input.scheduledFor },
    )
    return {
      taskId: r.task_id,
      scheduledFor: r.scheduled_for,
      expiresAt: r.expires_at,
    }
  }

  async function report(id: string, input: ScheduledReportInput): Promise<ScheduledTask> {
    const w = await http<WireTask>('POST', `/tasks/${encodeURIComponent(id)}/report`, {
      device_id: input.deviceId,
      outcome: input.outcome,
      error: input.error,
      state: input.state,
    })
    return wireToTask(w)
  }

  function onFire(ownerSpace: string, fn: (event: ScheduledFireEvent) => void): Unsubscribe {
    const h: FireHandler = { ownerSpace, fn }
    handlers.add(h)
    ensureBus()
    return () => {
      handlers.delete(h)
      maybeCloseBus()
    }
  }

  return { create, list, get, update, toggle, cancel, runNow, claim, report, onFire }
}
