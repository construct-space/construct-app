import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useOrgData } from './useOrgData'
import type { OrgRole } from '@/types/org'

/**
 * Permission-based access control for the current user in the org.
 *
 * Permissions are atomic strings like "members.edit", "projects.create".
 * Roles are bags of permissions stored in org_roles / org_role_permissions.
 * Wildcard matching: "projects.*" grants "projects.create", "projects.view", etc.
 */
export function useOrgPermissions() {
  const authStore = useAuthStore()
  const { members, roles } = useOrgData()

  const currentMember = computed(() => {
    const userId = authStore.user?.id
    if (!userId) return null
    return members.value.find(m => m.user_id === userId) ?? null
  })

  const currentRole = computed<OrgRole | null>(() => {
    const member = currentMember.value
    if (!member || !member.role_id) return null
    return roles.value.find(r => r.id === member.role_id) ?? null
  })

  const currentPermissions = computed<string[]>(() => {
    return currentRole.value?.permissions ?? []
  })

  // --- Core permission check ---

  function hasPermission(permission: string): boolean {
    // Scope-endpoint owner bypass. /api/me/scope is authoritative about
    // the user's org role and resolves fast at app boot, before the
    // heavier members + roles fetches land. Previously permission
    // checks required the full member+role graph to load AND the role
    // record to have `name === 'Owner'` (exact case) — so org owners
    // saw "no button" during the first few hundred ms of every page
    // load, and forever if the role row was stored as "owner"
    // lowercase. Trust scope when it says owner.
    const rolesFromScope = authStore.roles ?? []
    if (rolesFromScope.includes('owner')) return true
    if ((authStore.orgRole ?? '').toLowerCase() === 'owner') return true

    const member = currentMember.value
    if (!member) return false

    // Role-record bypass — covers the "scope endpoint hasn't refreshed
    // but the member+role fetch did" case. Case-insensitive so "owner"
    // / "Owner" both match.
    if (currentRole.value?.name?.toLowerCase() === 'owner') return true

    const perms = currentPermissions.value
    for (const granted of perms) {
      if (matchPermission(granted, permission)) return true
    }
    return false
  }

  function matchPermission(granted: string, required: string): boolean {
    if (granted === '*') return true
    if (granted === required) return true
    if (granted.endsWith('.*')) {
      const prefix = granted.slice(0, -2)
      if (required.startsWith(prefix + '.')) return true
    }
    return false
  }

  // --- Convenience checks ---

  const role = computed(() => currentRole.value?.name?.toLowerCase() ?? currentMember.value?.role ?? null)
  // Same three-source owner resolution as hasPermission: scope roles
  // first (fastest + authoritative), scope.orgRole second, role record
  // last. Avoids a first-paint flash where UI gates on role
  // capitalization alone.
  const isOwner = computed(() => {
    if ((authStore.roles ?? []).includes('owner')) return true
    if ((authStore.orgRole ?? '').toLowerCase() === 'owner') return true
    return currentRole.value?.name?.toLowerCase() === 'owner'
  })
  const isAdmin = computed(() => hasPermission('org.edit'))
  const isManager = computed(() => hasPermission('projects.create'))
  const isMember = computed(() => role.value !== null)

  // Members
  const canAddMember = computed(() => hasPermission('members.invite'))

  function canEditMember(memberId: string): boolean {
    if (hasPermission('members.edit')) return true
    return currentMember.value?.id === memberId
  }

  function canRemoveMember(targetRole: string): boolean {
    if (!hasPermission('members.remove')) return false
    if (targetRole === 'owner') return false
    return true
  }

  function canEditMemberRole(targetRole: string): boolean {
    if (!hasPermission('members.edit')) return false
    if (targetRole === 'owner') return false
    return true
  }

  function isOwnProfile(memberId: string): boolean {
    return currentMember.value?.id === memberId
  }

  // Departments & Teams
  const canManageDepartments = computed(() => hasPermission('departments.create'))
  const canManageTeams = computed(() => hasPermission('departments.create'))

  // Invitations
  const canManageInvites = computed(() => hasPermission('members.invite'))
  const canViewInvites = computed(() => hasPermission('members.invite'))

  // Settings
  const canEditSettings = computed(() => hasPermission('org.edit'))
  const canDisableOrg = computed(() => hasPermission('org.delete'))
  const canManageProviderKeys = computed(() => hasPermission('providers.manage'))

  // Roles
  const canManageRoles = computed(() => hasPermission('roles.create'))
  const canViewRoles = computed(() => hasPermission('roles.view'))

  // Activity
  const canViewActivity = computed(() => hasPermission('activity.view'))

  // Navigation visibility
  const visiblePages = computed(() => {
    const pages = ['dashboard', 'members', 'departments']
    if (hasPermission('members.invite')) pages.push('invitations')
    if (hasPermission('activity.view')) pages.push('activity')
    if (hasPermission('org.edit')) pages.push('settings')
    return pages
  })

  return {
    currentMember,
    currentRole,
    currentPermissions,
    role,
    isOwner,
    isAdmin,
    isManager,
    isMember,

    hasPermission,

    canAddMember,
    canEditMember,
    canRemoveMember,
    canEditMemberRole,
    isOwnProfile,

    canManageDepartments,
    canManageTeams,

    canManageInvites,
    canViewInvites,

    canEditSettings,
    canDisableOrg,
    canManageProviderKeys,

    canManageRoles,
    canViewRoles,

    canViewActivity,

    visiblePages,
  }
}
