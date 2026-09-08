/**
 * useOrgRoles — read slice of org roles + permission-aware helpers.
 *
 * Spaces use this to gate UI actions ("hide Delete unless admin") and
 * to render role-adjacent metadata. Roles are fetched as part of the
 * main org bundle (fetchAll); no separate endpoint.
 */
import { computed } from 'vue'
import { useOrgStore } from '@/stores/org'
import { useAuthStore } from '@/stores/auth'
import type { OrgRole } from '@/types/org'

function roleKey(name: string): string {
  return name.trim().toLowerCase()
}

function matchesPermission(granted: string, required: string): boolean {
  if (granted === '*') return true
  if (granted === required) return true
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -2)
    return required.startsWith(prefix + '.')
  }
  return false
}

export function useOrgRoles() {
  const org = useOrgStore()
  const auth = useAuthStore()

  if (!org.hydrated && !org.loading) {
    org.fetchAll().catch(() => { /* surface via loading state */ })
  }

  return {
    /** All roles defined in the current org (builtin + custom). */
    roles: computed<OrgRole[]>(() => org.roles),
    /** True while a fetch is in flight. */
    loading: computed<boolean>(() => org.loading),

    /** Lookup by role id. */
    byId: (id: string): OrgRole | null =>
      org.roles.find(r => r.id === id) ?? null,
    /** Lookup by human-readable name (e.g. "owner", "admin"). */
    byName: (name: string): OrgRole | null =>
      org.roles.find(r => roleKey(r.name) === roleKey(name)) ?? null,

    /** Role assigned to a given member by role_id. */
    ofMember: (memberId: string): OrgRole | null => {
      const m = org.members.find(x => x.id === memberId)
      if (!m?.role_id) return null
      return org.roles.find(r => r.id === m.role_id) ?? null
    },

    /**
     * Permission gate: does the currently signed-in user hold `perm`
     * through any of their roles? Uses auth.roles (from /api/me/scope)
     * to find active role records, then checks the union of permissions.
     */
    can: (perm: string): boolean => {
      if (!org.roles.length) return false
      const active = new Set((auth.roles || []).map(roleKey))
      for (const r of org.roles) {
        if (!active.has(roleKey(r.name))) continue
        if (r.permissions.some(granted => matchesPermission(granted, perm))) return true
      }
      return false
    },

    /** Force a fresh fetch. */
    refresh: (): Promise<void> => org.fetchAll(),
  }
}
