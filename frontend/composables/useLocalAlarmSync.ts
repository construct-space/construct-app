/**
 * useLocalAlarmSync — mirrors the user's enabled notify-class scheduled tasks
 * into the Rust local alarm scheduler (desktop/src/local_alarms.rs).
 *
 * The server scheduler stays the source of truth; this just pushes the current
 * task set to Rust so it can ring natively even when the window is
 * closed-to-tray and offline. Re-syncs on launch, on a short interval (so a
 * just-created alarm lands quickly), and on window focus.
 */
import { isTauriEnv } from '@/utils/tauri'

const SYNC_INTERVAL_MS = 60_000

interface SchedulerNotify {
  title?: string
  [key: string]: unknown
}

let started = false

async function syncOnce(): Promise<void> {
  try {
    const { useScheduler } = await import('@/composables/useScheduler')
    const tasks = await useScheduler().list()
    const alarms = tasks
      .filter((t) => {
        const notify = (t.action as { notify?: SchedulerNotify } | undefined)?.notify
        return t.enabled && !!notify?.title
      })
      .map((t) => ({
        taskId: t.id,
        schedule: t.schedule,
        notify: (t.action as { notify?: SchedulerNotify }).notify,
      }))

    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('local_alarms_sync', { alarms })
  } catch (err) {
    console.warn('[localAlarms] sync failed:', err)
  }
}

// Coalesce bursts of mutations (e.g. create + immediate enable) into one sync.
let pending: ReturnType<typeof setTimeout> | null = null
function syncSoon(): void {
  if (pending) return
  pending = setTimeout(() => { pending = null; void syncOnce() }, 250)
}

/** Idempotent. Call once from the primary window after auth is ready. */
export function startLocalAlarmSync(): void {
  if (started || !isTauriEnv()) return
  started = true
  void syncOnce()
  setInterval(() => void syncOnce(), SYNC_INTERVAL_MS)
  window.addEventListener('focus', () => void syncOnce())
  // Re-sync the moment a task is created/changed/cancelled — without this a
  // short timer (or just-created alarm) wouldn't reach the Rust scheduler
  // until the next 60s tick, missing its fire window once the space page that
  // created it has unmounted. See SCHEDULER_CHANGED_EVENT in useScheduler.ts.
  window.addEventListener('construct:scheduler-changed', () => syncSoon())
}
