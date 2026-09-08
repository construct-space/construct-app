/**
 * useDeveloperGate — single source of truth for "is the Developer Portal
 * available to this user right now?"
 *
 * Two independent enrollment signals decide visibility:
 *   - personal: `auth.developer_status === 'enrolled'` (per-user, set in
 *     Settings → Developer).
 *   - org: the org-Developer role grants `projects.create`, which is the
 *     permission that already gates org-project creation in
 *     OrgProjectsPage.
 *
 * The active scope (personal vs org) is decided by `orgStore.isEnabled`
 * — when an org is active it takes precedence. Org mode additionally
 * requires the user to be a developer: simply setting up an organization
 * does NOT open org projects — the user must be BOTH org and developer.
 * So:
 *
 *   org active + isDeveloper + projects.create → mode = 'org'
 *   org active + not developer                 → mode = null (no icon)
 *   org active + no projects.create            → mode = null (no icon)
 *   no org active + isDeveloper                → mode = 'personal'
 *   no org active + not developer              → mode = null (no icon)
 *
 * Sidebar visibility, the route guard, and the portal page all read
 * from this composable so the gate stays consistent across the app.
 */

import { computed, type ComputedRef } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useOrgStore } from '@/stores/org'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'

export type DeveloperMode = 'personal' | 'org' | null

export interface DeveloperGate {
  mode: ComputedRef<DeveloperMode>
  visible: ComputedRef<boolean>
  isPersonal: ComputedRef<boolean>
  isOrg: ComputedRef<boolean>
}

export function useDeveloperGate(): DeveloperGate {
  const auth = useAuthStore()
  const orgStore = useOrgStore()
  const { hasPermission } = useOrgPermissions()

  const mode = computed<DeveloperMode>(() => {
    if (orgStore.isEnabled) {
      // Org projects open only when the user is BOTH org and developer —
      // setting up an organization alone is not enough.
      return auth.isDeveloper && hasPermission('projects.create') ? 'org' : null
    }
    return auth.isDeveloper ? 'personal' : null
  })

  return {
    mode,
    visible: computed(() => mode.value !== null),
    isPersonal: computed(() => mode.value === 'personal'),
    isOrg: computed(() => mode.value === 'org'),
  }
}
