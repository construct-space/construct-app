/**
 * useDelivery — transactional email from a space.
 *
 * Wraps POST /api/emails on api.construct.delivery directly. v1 sends
 * From the shared "construct.delivery" domain, so a space can ship
 * welcome emails, password resets, and notifications without each user
 * verifying their own DNS. Custom domains will be a paid upgrade later.
 *
 * Auth: cat_ Bearer token from the host auth store. Delivery validates
 * it against accounts /internal/validate-token (same call the gateway
 * makes via auth_request) — skipping the gateway lets the SDK avoid the
 * cross-VPS HTTPS hop entirely.
 *
 * Two call shapes (see @construct-space/sdk for the public type):
 *
 *   const email = useDelivery()
 *   await email.send({ to, subject, html, layout: 'construct' })
 *
 *   await email.message().to(...).subject(...).html(...).tag(...).send()
 */

import { appConfig } from '@/utils/config'
import { useAuthStore } from '@/stores/auth'
import { useNotification } from '@/composables/useNotification'
import type {
  DeliveryMessageInput,
  DeliveryMessageResponse,
  DeliveryMessageBuilder,
  DeliveryAttachment,
  SelfNotifyInput,
  SelfNotifyResponse,
} from '@construct-space/sdk'

export type {
  DeliveryMessageInput,
  DeliveryMessageResponse,
  DeliveryMessageBuilder,
  DeliveryAttachment,
  SelfNotifyInput,
  SelfNotifyResponse,
}

interface DeliveryClient {
  send(message: DeliveryMessageInput): Promise<DeliveryMessageResponse>
  message(): DeliveryMessageBuilder
  get(id: string): Promise<DeliveryMessageResponse>
  notify(input: SelfNotifyInput): Promise<SelfNotifyResponse>
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

export function useDelivery(): DeliveryClient {
  const auth = useAuthStore()
  const base = appConfig.deliveryUrl.replace(/\/$/, '')
  const notifications = useNotification()

  async function send(message: DeliveryMessageInput): Promise<DeliveryMessageResponse> {
    if (!message.to) throw new Error('to is required')
    if (!message.subject) throw new Error('subject is required')
    if (!message.html && !message.text) {
      throw new Error('html or text is required')
    }

    const res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: buildHeaders(auth.token),
      body: JSON.stringify(message),
    })
    if (!res.ok) throw new Error(await readErrorMessage(res))
    return (await res.json()) as DeliveryMessageResponse
  }

  async function get(id: string): Promise<DeliveryMessageResponse> {
    const res = await fetch(`${base}/emails/${encodeURIComponent(id)}`, {
      headers: buildHeaders(auth.token),
    })
    if (!res.ok) throw new Error(await readErrorMessage(res))
    return (await res.json()) as DeliveryMessageResponse
  }

  async function notify(input: SelfNotifyInput): Promise<SelfNotifyResponse> {
    return notifications.send(input)
  }

  function message(): DeliveryMessageBuilder {
    const draft: DeliveryMessageInput = {
      to: '',
      subject: '',
    }
    const builder: DeliveryMessageBuilder = {
      from(addr) { draft.from = addr; return builder },
      to(addr) { draft.to = addr; return builder },
      subject(s) { draft.subject = s; return builder },
      html(s) { draft.html = s; return builder },
      text(s) { draft.text = s; return builder },
      header(key, value) {
        draft.headers = { ...(draft.headers || {}), [key]: value }
        return builder
      },
      tag(name) {
        draft.tags = [...(draft.tags || []), name]
        return builder
      },
      space(name) { draft.space = name; return builder },
      attach(att) {
        draft.attachments = [...(draft.attachments || []), att]
        return builder
      },
      send: () => send(draft),
      toJSON: () => ({
        ...draft,
        headers: draft.headers ? { ...draft.headers } : undefined,
        tags: draft.tags ? [...draft.tags] : undefined,
        attachments: draft.attachments ? [...draft.attachments] : undefined,
      }),
    }
    return builder
  }

  return { send, message, get, notify }
}
