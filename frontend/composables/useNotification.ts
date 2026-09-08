/**
 * useNotification — host-owned toast stack + durable self notifications.
 *
 * Lives in the host (not in @construct-space/ui) so there's one
 * authoritative `notifications` ref. The UI package previously carried
 * both the composable and the Notification component; dual-bundling
 * against the dist ESM vs the ts sources produced two module instances,
 * which meant `notify()` pushed to one singleton and the mounted
 * `<Notification />` read from the other — so toasts silently never
 * rendered. Keeping everything host-side avoids that split.
 *
 * SDK spaces also call `useNotification().send()` to write a durable
 * notification into the current user's bell/inbox. That path goes through
 * my.construct.space's /api/notifications gateway surface.
 */
import { ref } from 'vue'
import { appConfig } from '@/utils/config'
import { useAuthStore } from '@/stores/auth'
import type { SelfNotifyInput, SelfNotifyResponse } from '@construct-space/sdk'

export interface Notification {
  id: string
  title: string
  description?: string
  color?: 'success' | 'error' | 'warning' | 'info'
  duration?: number
  action?: { label: string; onClick: () => void }
}

const notifications = ref<Notification[]>([])
let idCounter = 0

function add(notification: Omit<Notification, 'id'>): string {
  const id = `notification-${++idCounter}-${Date.now()}`
  const duration = notification.duration ?? 5000

  notifications.value.push({ ...notification, id })

  if (duration > 0) {
    setTimeout(() => {
      remove(id)
    }, duration)
  }

  return id
}

function remove(id: string): void {
  const index = notifications.value.findIndex((t) => t.id === id)
  if (index !== -1) {
    notifications.value.splice(index, 1)
  }
}

function clear(): void {
  notifications.value.splice(0, notifications.value.length)
}

function notificationsBase(): string {
  const base = appConfig.notificationsUrl || `${appConfig.gatewayUrl}/api/notifications`
  return base.replace(/\/$/, '')
}

function buildHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function readErrorMessage(res: Response): Promise<string> {
  const txt = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(txt) as { error?: string; message?: string }
    return parsed.error || parsed.message || `Request failed (${res.status})`
  } catch {
    return txt || `Request failed (${res.status})`
  }
}

async function send(input: SelfNotifyInput): Promise<SelfNotifyResponse> {
  if (!input.title) throw new Error('title is required')

  const auth = useAuthStore()
  const token = auth.oauthToken || auth.token
  const res = await fetch(`${notificationsBase()}/self`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({
      title: input.title,
      body: input.body || '',
      type: input.type || 'self.message',
      source: input.source || 'self',
      link: input.link,
      data: input.data,
    }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as SelfNotifyResponse
}

export function useNotification() {
  return {
    notifications,
    add,
    remove,
    clear,
    notification: { add, remove, clear },
    send,
  }
}

/** Quick notification helper — `notify('Saved!')` or `notify('Error', 'error')`. */
export function notify(
  title: string,
  color?: Notification['color'],
  description?: string,
): string {
  return add({ title, color: color || 'info', description })
}
