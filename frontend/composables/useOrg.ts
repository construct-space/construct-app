/**
 * useOrg — basic org context any org-scoped space needs.
 *
 * Collapses the reach-into-multiple-stores pattern (useOrgStore for
 * id/name, useAuthStore for scope/role) into one read surface. Doesn't
 * auto-fetch — the bits exposed here land during app boot via
 * authStore.checkOrgMembership and are cheap to consult.
 */
import { computed } from 'vue'
import { useOrgStore } from '@/stores/org'
import { useAuthStore } from '@/stores/auth'
import type { Organization } from '@/types/org'

export function useOrg() {
  const org = useOrgStore()
  const auth = useAuthStore()

  return {
    /** Current org id, or null when the user isn't in an org. */
    orgId: computed<string | null>(() => org.orgId),
    /** Display name. */
    orgName: computed<string | null>(() => org.orgName),
    /** Full record (slug, icon, owner, timestamps) once hydrated. */
    currentOrg: computed<Organization | null>(() => org.currentOrg),
    /** True when the user is in an org context (vs personal). */
    isOrg: computed<boolean>(() => auth.scope === 'org' && org.isEnabled),
    /** Role strings from the scope endpoint: ['owner'|'admin'|'developer'|…]. */
    roles: computed<string[]>(() => auth.roles),
    /** Convenience gate for admin UIs. */
    isAdmin: computed<boolean>(() => auth.isOrgAdmin),
    /** True while the first org fetch is in flight. */
    loading: computed<boolean>(() => org.loading),
    /** Force a refresh of the org + member/team/etc caches. */
    refresh: (): Promise<void> => org.fetchAll(),
  }
}
