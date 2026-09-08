/**
 * useAccess — per-row ABAC composable.
 *
 * Delegates to source-api endpoints (/access/can, /access/grant,
 * /access/revoke, /access/list, /access/members). Personal context
 * (no active org) short-circuits to `true` — only org context enforces
 * row-level ACL. Backend may not yet implement every endpoint; calls
 * fail soft and resolve with empty/false results so UI stays usable.
 */

import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useOrg } from '@/composables/useOrg'
import { appConfig } from '@/utils/config'

export interface AccessMember {
  user_id: string
  role: string
  granted_at?: string
  granted_by?: string
}

function resourceKey(resource: unknown): string {
  if (resource == null) return ''
  if (typeof resource === 'string' || typeof resource === 'number') return String(resource)
  if (typeof resource === 'object') {
    const r = resource as Record<string, unknown>
    if (typeof r.id === 'string' || typeof r.id === 'number') return String(r.id)
    if (typeof r.uuid === 'string') return r.uuid
  }
  try {
    return JSON.stringify(resource)
  } catch {
    return ''
  }
}

async function call<T>(
  path: string,
  body: Record<string, unknown>,
  token: string | null,
): Promise<T | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${appConfig.sourceUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function useAccess<T = unknown>() {
  const auth = useAuthStore()
  const org = useOrg()

  function can(action: string, resource: T): Ref<boolean> {
    const out = ref(false)
    if (!org.isOrg.value) {
      out.value = true
      return out
    }
    const key = resourceKey(resource)
    void call<{ allowed: boolean }>('/access/can', { action, resource: key }, auth.token).then((r) => {
      out.value = !!r?.allowed
    })
    return out
  }

  function canSync(_action: string, _resource: T): boolean {
    // Personal context: always true. Org context: optimistic false until
    // can()'s async result lands (host should prefer the reactive form).
    if (!org.isOrg.value) return true
    return false
  }

  function filter(action: string, items: T[]): Ref<T[]> {
    const out = ref<T[]>([]) as Ref<T[]>
    if (!org.isOrg.value) {
      out.value = items
      return out
    }
    Promise.all(
      items.map(async (item): Promise<{ item: T; ok: boolean }> => {
        const r = await call<{ allowed: boolean }>(
          '/access/can',
          { action, resource: resourceKey(item) },
          auth.token,
        )
        return { item, ok: !!r?.allowed }
      }),
    ).then((results) => {
      out.value = results.filter((x) => x.ok).map((x) => x.item)
    })
    return out
  }

  function decide(action: string, items: T[]): Ref<Map<string, boolean>> {
    const out = ref(new Map<string, boolean>())
    if (!org.isOrg.value) {
      const m = new Map<string, boolean>()
      for (const it of items) m.set(resourceKey(it), true)
      out.value = m
      return out
    }
    Promise.all(
      items.map(async (item) => {
        const key = resourceKey(item)
        const r = await call<{ allowed: boolean }>(
          '/access/can',
          { action, resource: key },
          auth.token,
        )
        return [key, !!r?.allowed] as const
      }),
    ).then((entries) => {
      out.value = new Map(entries)
    })
    return out
  }

  function members(resource: T): Ref<AccessMember[]> {
    const out = ref<AccessMember[]>([])
    void call<{ members: AccessMember[] }>(
      '/access/list',
      { resource: resourceKey(resource) },
      auth.token,
    ).then((r) => {
      out.value = r?.members ?? []
    })
    return out
  }

  function isOrgWide(_resource: T): Ref<boolean> {
    return ref(false)
  }

  function isRestricted(resource: T): Ref<boolean> {
    const m = members(resource)
    return computed(() => m.value.length > 0) as Ref<boolean>
  }

  function hasAccess(resource: T, userId: string): Ref<boolean> {
    const m = members(resource)
    return computed(() => m.value.some((x) => x.user_id === userId)) as Ref<boolean>
  }

  function roleOf(resource: T, userId: string): Ref<string | null> {
    const m = members(resource)
    return computed(() => m.value.find((x) => x.user_id === userId)?.role ?? null) as Ref<string | null>
  }

  function hasRoleAtLeast(resource: T, role: string): Ref<boolean> {
    const order = ['viewer', 'commenter', 'editor', 'admin', 'owner']
    const m = members(resource)
    const target = order.indexOf(role)
    return computed(() => {
      if (target < 0) return false
      const me = auth.user?.id
      if (!me) return false
      const mine = m.value.find((x) => x.user_id === String(me))?.role
      if (!mine) return false
      return order.indexOf(mine) >= target
    }) as Ref<boolean>
  }

  async function grant(resource: T, userId: string, role: string): Promise<void> {
    await call('/access/grant', { resource: resourceKey(resource), user_id: userId, role }, auth.token)
  }

  async function revoke(resource: T, userId: string): Promise<void> {
    await call('/access/revoke', { resource: resourceKey(resource), user_id: userId }, auth.token)
  }

  async function setRole(resource: T, userId: string, role: string): Promise<void> {
    await call(
      '/access/grant',
      { resource: resourceKey(resource), user_id: userId, role },
      auth.token,
    )
  }

  async function openToOrg(resource: T): Promise<void> {
    await call('/access/open', { resource: resourceKey(resource) }, auth.token)
  }

  async function transferOwnership(resource: T, toUserId: string): Promise<void> {
    await call(
      '/access/transfer',
      { resource: resourceKey(resource), to_user_id: toUserId },
      auth.token,
    )
  }

  return {
    can,
    canSync,
    filter,
    decide,
    members,
    isOrgWide,
    isRestricted,
    hasAccess,
    roleOf,
    hasRoleAtLeast,
    grant,
    revoke,
    setRole,
    openToOrg,
    transferOwnership,
  }
}
