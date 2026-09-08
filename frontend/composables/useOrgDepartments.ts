/**
 * useOrgDepartments — read slice of departments + cross-lookups to members.
 *
 * Departments are the top organizational grouping (Engineering, Design,
 * Ops). Use for group headers, filters, and per-department dashboards.
 */
import { computed } from 'vue'
import { useOrgStore } from '@/stores/org'
import type { Department, OrgMember } from '@/types/org'

export function useOrgDepartments() {
  const org = useOrgStore()

  if (!org.hydrated && !org.loading) {
    org.fetchAll().catch(() => { /* surface via loading state */ })
  }

  return {
    /** Reactive list of departments. */
    departments: computed<Department[]>(() => org.departments),
    /** True while a fetch is in flight. */
    loading: computed<boolean>(() => org.loading),
    /** Department count — for badges. */
    departmentCount: computed<number>(() => org.departmentCount),

    /** Lookup by id. */
    byId: (id: string): Department | null =>
      org.departments.find(d => d.id === id) ?? null,

    /** Department of a given member (null if unassigned). */
    ofMember: (memberId: string): Department | null => {
      const member = org.members.find(m => m.id === memberId)
      if (!member?.department_id) return null
      return org.departments.find(d => d.id === member.department_id) ?? null
    },

    /** All members in a department (empty when id is null/unknown). */
    membersOf: (deptId: string): OrgMember[] =>
      org.members.filter(m => m.department_id === deptId),

    /** Force a fresh fetch. */
    refresh: (): Promise<void> => org.fetchAll(),
  }
}
