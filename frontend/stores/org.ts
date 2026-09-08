import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSource } from '@/composables/useSource'
import { useAuthStore } from '@/stores/auth'
import type {
  ActivityEntry,
  ActivityResponse,
  Department,
  ManagedSettingsBundle,
  OrgInvite,
  OrgMember,
  OrgProviderEntry,
  OrgRole,
  OrgSettings,
  Organization,
  PermissionDef,
  Team,
  TeamMember,
} from '@/types/org'

import { getActiveProfileId } from '@/lib/profileStorage'

// Org settings key is scoped to the active profile to prevent cross-profile leaks.
function settingsKey(): string {
  const profileId = getActiveProfileId()
  if (profileId) return `construct:org:${profileId}`
  return 'construct:org'
}

function loadSettings(): OrgSettings {
  try {
    const raw = localStorage.getItem(settingsKey())
    return raw ? JSON.parse(raw) : { enabled: false, org_id: '', org_name: '' }
  }
  catch {
    return { enabled: false, org_id: '', org_name: '' }
  }
}

function saveSettings(s: OrgSettings): void {
  localStorage.setItem(settingsKey(), JSON.stringify(s))
}

export const useOrgStore = defineStore('org', () => {
  const api = useSource()

  const settings = ref<OrgSettings>(loadSettings())
  const currentOrg = ref<Organization | null>(null)
  const members = ref<OrgMember[]>([])
  const departments = ref<Department[]>([])
  const teams = ref<Team[]>([])
  const teamMembers = ref<TeamMember[]>([])
  const invites = ref<OrgInvite[]>([])
  const activity = ref<ActivityEntry[]>([])
  const activityTotal = ref(0)
  const roles = ref<OrgRole[]>([])
  const permissions = ref<PermissionDef[]>([])
  const loading = ref(false)
  const hydrated = ref(false)

  const isEnabled = computed(() => settings.value.enabled)
  const orgId = computed(() => settings.value.org_id)
  const orgName = computed(() => settings.value.org_name)
  const memberCount = computed(() => members.value.length)
  const departmentCount = computed(() => departments.value.length)
  const teamCount = computed(() => teams.value.length)
  const pendingInviteCount = computed(() => invites.value.filter(i => i.status === 'pending').length)

  // ---------------------------------------------------------------------------
  // Fetch all data from the API
  // ---------------------------------------------------------------------------

  async function fetchAll(): Promise<void> {
    if (hydrated.value && !settings.value.enabled) return

    loading.value = true
    try {
      const orgRes = await api.get<Organization>('/org').catch(() => null)

      if (!orgRes || !orgRes.id) {
        settings.value = { enabled: false, org_id: '', org_name: '' }
        saveSettings(settings.value)
        hydrated.value = true
        loading.value = false
        return
      }

      const [membersRes, deptsRes, teamsRes, invitesRes, activityRes, rolesRes, permsRes] = await Promise.all([
        api.get<OrgMember[]>('/org/members').catch(() => []),
        api.get<Department[]>('/org/departments').catch(() => []),
        api.get<Team[]>('/org/teams').catch(() => []),
        api.get<OrgInvite[]>('/org/invites').catch(() => []),
        api.get<ActivityResponse>('/org/activity').catch(() => ({ data: [], total: 0 })),
        api.get<OrgRole[]>('/org/roles').catch(() => []),
        api.get<PermissionDef[]>('/org/permissions').catch(() => []),
      ])

      currentOrg.value = orgRes
      settings.value = { enabled: true, org_id: orgRes.id, org_name: orgRes.name }
      saveSettings(settings.value)

      members.value = Array.isArray(membersRes) ? membersRes : []
      departments.value = Array.isArray(deptsRes) ? deptsRes : []
      teams.value = Array.isArray(teamsRes) ? teamsRes : []
      invites.value = Array.isArray(invitesRes) ? invitesRes : []
      activity.value = Array.isArray(activityRes?.data) ? activityRes.data : []
      activityTotal.value = activityRes?.total ?? activity.value.length
      roles.value = Array.isArray(rolesRes) ? rolesRes : []
      permissions.value = Array.isArray(permsRes) ? permsRes : []

      // Fetch team members for each team
      const tmResults = await Promise.all(
        teams.value.map(t =>
          api.get<TeamMember[]>(`/org/teams/${t.id}/members`).catch(() => []),
        ),
      )
      teamMembers.value = tmResults.flat()
      hydrated.value = true
    }
    catch (err) {
      console.error('[org] fetchAll failed:', err)
    }
    finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // Org lifecycle
  // ---------------------------------------------------------------------------

  async function enable(name: string): Promise<void> {
    try {
      const existing = await api.get<Organization>('/org').catch(() => null)
      if (existing && existing.id) {
        currentOrg.value = existing
        settings.value = { enabled: true, org_id: existing.id, org_name: existing.name }
        saveSettings(settings.value)
        await fetchAll()
        return
      }

      const org = await api.post<Organization>('/org', { name })
      currentOrg.value = org
      settings.value = { enabled: true, org_id: org.id, org_name: org.name }
      saveSettings(settings.value)

      const authStore = useAuthStore()
      const ownerMembers = await api.get<OrgMember[]>('/org/members').catch(() => [])
      const owner = Array.isArray(ownerMembers) ? ownerMembers.find(m => m.role === 'owner') : null
      if (owner && authStore.user) {
        await api.put<OrgMember>(`/org/members/${owner.id}`, {
          name: authStore.user.name || authStore.user.email || 'Owner',
          email: authStore.user.email || '',
        }).catch(() => null)
      }

      await fetchAll()
    }
    catch (err) {
      console.error('[org] enable failed:', err)
    }
  }

  async function disable(): Promise<void> {
    try {
      await api.delete('/org')
    }
    catch (err) {
      console.error('[org] disable (API) failed:', err)
    }
    settings.value = { enabled: false, org_id: '', org_name: '' }
    saveSettings(settings.value)
    currentOrg.value = null
    members.value = []
    departments.value = []
    teams.value = []
    teamMembers.value = []
    invites.value = []
    activity.value = []
    roles.value = []
    permissions.value = []
  }

  async function updateOrg(updates: { name?: string; icon?: string }): Promise<Organization | null> {
    try {
      const updated = await api.put<Organization>('/org', updates)
      currentOrg.value = updated
      if (updated.name) {
        settings.value = { ...settings.value, org_name: updated.name }
        saveSettings(settings.value)
      }
      return updated
    }
    catch (err) {
      console.error('[org] updateOrg failed:', err)
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  async function addMember(data: Omit<OrgMember, 'id' | 'org_id' | 'joined_at' | 'last_active_at' | 'created_at' | 'updated_at'>): Promise<OrgMember | null> {
    try {
      const member = await api.post<OrgMember>('/org/members', {
        name: data.name,
        email: data.email,
        role: data.role,
        title: data.title,
        department_id: data.department_id,
      })
      members.value.push(member)
      return member
    }
    catch (err) {
      console.error('[org] addMember failed:', err)
      return null
    }
  }

  async function updateMember(id: string, updates: Partial<OrgMember>): Promise<OrgMember | null> {
    try {
      const updated = await api.put<OrgMember>(`/org/members/${id}`, updates)
      const idx = members.value.findIndex(m => m.id === id)
      if (idx !== -1) members.value[idx] = updated
      return updated
    }
    catch (err) {
      console.error('[org] updateMember failed:', err)
      return null
    }
  }

  async function removeMember(id: string): Promise<boolean> {
    try {
      await api.delete(`/org/members/${id}`)
      members.value = members.value.filter(m => m.id !== id)
      teamMembers.value = teamMembers.value.filter(tm => tm.member_id !== id)
      return true
    }
    catch (err) {
      console.error('[org] removeMember failed:', err)
      return false
    }
  }

  async function assignMemberRole(memberId: string, roleId: string): Promise<OrgMember | null> {
    try {
      const updated = await api.put<OrgMember>(`/org/members/${memberId}/role`, { role_id: roleId })
      const idx = members.value.findIndex(m => m.id === memberId)
      if (idx !== -1) members.value[idx] = updated
      return updated
    }
    catch (err) {
      console.error('[org] assignMemberRole failed:', err)
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------

  async function fetchRoles(): Promise<void> {
    try {
      const [rolesRes, permsRes] = await Promise.all([
        api.get<OrgRole[]>('/org/roles'),
        api.get<PermissionDef[]>('/org/permissions'),
      ])
      roles.value = Array.isArray(rolesRes) ? rolesRes : []
      permissions.value = Array.isArray(permsRes) ? permsRes : []
    }
    catch (err) {
      console.error('[org] fetchRoles failed:', err)
    }
  }

  async function createRole(data: { name: string; description: string; permissions: string[] }): Promise<OrgRole | null> {
    try {
      const role = await api.post<OrgRole>('/org/roles', data)
      roles.value.push(role)
      return role
    }
    catch (err) {
      console.error('[org] createRole failed:', err)
      return null
    }
  }

  async function updateRole(id: string, updates: { name?: string; description?: string; permissions?: string[] }): Promise<OrgRole | null> {
    try {
      const updated = await api.put<OrgRole>(`/org/roles/${id}`, updates)
      const idx = roles.value.findIndex(r => r.id === id)
      if (idx !== -1) roles.value[idx] = updated
      return updated
    }
    catch (err) {
      console.error('[org] updateRole failed:', err)
      return null
    }
  }

  async function removeRole(id: string): Promise<boolean> {
    try {
      await api.delete(`/org/roles/${id}`)
      roles.value = roles.value.filter(r => r.id !== id)
      return true
    }
    catch (err) {
      console.error('[org] removeRole failed:', err)
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Departments
  // ---------------------------------------------------------------------------

  async function addDepartment(data: Omit<Department, 'id' | 'org_id' | 'created_at' | 'updated_at'>): Promise<Department | null> {
    try {
      const dept = await api.post<Department>('/org/departments', {
        name: data.name,
        description: data.description,
        code: data.code,
        head_id: data.head_id,
      })
      departments.value.push(dept)
      return dept
    }
    catch (err) {
      console.error('[org] addDepartment failed:', err)
      return null
    }
  }

  async function updateDepartment(id: string, updates: Partial<Department>): Promise<Department | null> {
    try {
      const updated = await api.put<Department>(`/org/departments/${id}`, updates)
      const idx = departments.value.findIndex(d => d.id === id)
      if (idx !== -1) departments.value[idx] = updated
      return updated
    }
    catch (err) {
      console.error('[org] updateDepartment failed:', err)
      return null
    }
  }

  async function removeDepartment(id: string): Promise<boolean> {
    try {
      await api.delete(`/org/departments/${id}`)
      departments.value = departments.value.filter(d => d.id !== id)
      members.value.forEach((m) => {
        if (m.department_id === id) m.department_id = null
      })
      teams.value.forEach((t) => {
        if (t.department_id === id) t.department_id = null
      })
      return true
    }
    catch (err) {
      console.error('[org] removeDepartment failed:', err)
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------

  async function addTeam(data: Omit<Team, 'id' | 'org_id' | 'created_at' | 'updated_at'>): Promise<Team | null> {
    try {
      const team = await api.post<Team>('/org/teams', {
        name: data.name,
        description: data.description,
        department_id: data.department_id,
        lead_id: data.lead_id,
      })
      teams.value.push(team)
      return team
    }
    catch (err) {
      console.error('[org] addTeam failed:', err)
      return null
    }
  }

  async function updateTeam(id: string, updates: Partial<Team>): Promise<Team | null> {
    try {
      const updated = await api.put<Team>(`/org/teams/${id}`, updates)
      const idx = teams.value.findIndex(t => t.id === id)
      if (idx !== -1) teams.value[idx] = updated
      return updated
    }
    catch (err) {
      console.error('[org] updateTeam failed:', err)
      return null
    }
  }

  async function removeTeam(id: string): Promise<boolean> {
    try {
      await api.delete(`/org/teams/${id}`)
      teams.value = teams.value.filter(t => t.id !== id)
      teamMembers.value = teamMembers.value.filter(tm => tm.team_id !== id)
      return true
    }
    catch (err) {
      console.error('[org] removeTeam failed:', err)
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Team Members
  // ---------------------------------------------------------------------------

  async function addTeamMember(teamId: string, memberId: string): Promise<TeamMember | null> {
    try {
      const entry = await api.post<TeamMember>(`/org/teams/${teamId}/members`, { member_id: memberId })
      teamMembers.value.push(entry)
      return entry
    }
    catch (err) {
      console.error('[org] addTeamMember failed:', err)
      return null
    }
  }

  async function removeTeamMember(teamId: string, memberId: string): Promise<boolean> {
    try {
      await api.delete(`/org/teams/${teamId}/members/${memberId}`)
      teamMembers.value = teamMembers.value.filter(
        tm => !(tm.team_id === teamId && tm.member_id === memberId),
      )
      return true
    }
    catch (err) {
      console.error('[org] removeTeamMember failed:', err)
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Invites
  // ---------------------------------------------------------------------------

  async function addInvite(data: { email: string; role: string; department_id?: string | null; invited_by: string }): Promise<OrgInvite | null> {
    try {
      const invite = await api.post<OrgInvite>('/org/invites', {
        email: data.email,
        role: data.role,
        department_id: data.department_id,
      })
      invites.value.push(invite)
      return invite
    }
    catch (err) {
      console.error('[org] addInvite failed:', err)
      return null
    }
  }

  async function revokeInvite(id: string, _revokedBy?: string): Promise<boolean> {
    try {
      await api.put(`/org/invites/${id}/revoke`)
      const invite = invites.value.find(i => i.id === id)
      if (invite) invite.status = 'revoked'
      return true
    }
    catch (err) {
      console.error('[org] revokeInvite failed:', err)
      return false
    }
  }

  // Preview an invite without accepting it. Used by the join-confirmation
  // flow to decide whether to show the personal-developer dormancy warning
  // (personal publisher pauses when joining a non-publisher org).
  async function getInviteInfo(token: string): Promise<{
    email: string
    role: string
    status: string
    expires_at: string
    org: { id: string; name: string; slug: string; icon: string; is_publisher: boolean }
  } | null> {
    try {
      return await api.get(`/org/invites/${token}/info`)
    }
    catch (err) {
      console.error('[org] getInviteInfo failed:', err)
      return null
    }
  }

  async function acceptInvite(token: string): Promise<OrgMember | null> {
    try {
      const member = await api.post<OrgMember>(`/org/invites/${token}/accept`)
      const [updatedInvites, updatedMembers] = await Promise.all([
        api.get<OrgInvite[]>('/org/invites').catch(() => invites.value),
        api.get<OrgMember[]>('/org/members').catch(() => members.value),
      ])
      invites.value = Array.isArray(updatedInvites) ? updatedInvites : invites.value
      members.value = Array.isArray(updatedMembers) ? updatedMembers : members.value
      return member
    }
    catch (err) {
      console.error('[org] acceptInvite failed:', err)
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Activity
  // ---------------------------------------------------------------------------

  async function fetchActivity(limit = 50, offset = 0): Promise<void> {
    try {
      const res = await api.get<ActivityResponse>(`/org/activity?limit=${limit}&offset=${offset}`)
      activity.value = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res as unknown as ActivityEntry[] : []
      activityTotal.value = res?.total ?? activity.value.length
    }
    catch (err) {
      console.error('[org] fetchActivity failed:', err)
    }
  }

  // ---------------------------------------------------------------------------
  // Queries (local state filters)
  // ---------------------------------------------------------------------------

  function getMemberById(id: string): OrgMember | undefined {
    return members.value.find(m => m.id === id)
  }

  function getDepartmentById(id: string): Department | undefined {
    return departments.value.find(d => d.id === id)
  }

  function getTeamById(id: string): Team | undefined {
    return teams.value.find(t => t.id === id)
  }

  function getRoleById(id: string): OrgRole | undefined {
    return roles.value.find(r => r.id === id)
  }

  function getRoleByName(name: string): OrgRole | undefined {
    return roles.value.find(r => r.name.toLowerCase() === name.toLowerCase())
  }

  function getMembersByDepartment(deptId: string): OrgMember[] {
    return members.value.filter(m => m.department_id === deptId)
  }

  function getTeamsByDepartment(deptId: string): Team[] {
    return teams.value.filter(t => t.department_id === deptId)
  }

  function getTeamMembers(teamId: string): OrgMember[] {
    const memberIds = teamMembers.value.filter(tm => tm.team_id === teamId).map(tm => tm.member_id)
    return members.value.filter(m => memberIds.includes(m.id))
  }

  function getMemberRole(member: OrgMember): OrgRole | undefined {
    if (member.role_id) return getRoleById(member.role_id)
    return getRoleByName(member.role)
  }

  /** Reset all state for new profile. */
  function onProfileSwitch(): void {
    settings.value = loadSettings()
    currentOrg.value = null
    members.value = []
    departments.value = []
    teams.value = []
    teamMembers.value = []
    invites.value = []
    activity.value = []
    roles.value = []
    permissions.value = []
    hydrated.value = false
  }

  // Managed settings
  const managedSettings = ref<ManagedSettingsBundle | null>(null)

  const managedProviders = computed<OrgProviderEntry[]>(() => managedSettings.value?.providers || [])
  const isManagedSettingsAdmin = computed(() => managedSettings.value?.manageable ?? false)

  async function fetchManagedSettings(): Promise<void> {
    try {
      const data = await api.get<ManagedSettingsBundle>('/org/managed-settings')
      managedSettings.value = data
      if (data?.org_id) {
        settings.value = {
          enabled: true,
          org_id: data.org_id,
          org_name: data.org_name || settings.value.org_name || '',
        }
        saveSettings(settings.value)
      }
    }
    catch {
      managedSettings.value = null
    }
  }

  return {
    settings,
    currentOrg,
    members,
    departments,
    teams,
    teamMembers,
    invites,
    activity,
    activityTotal,
    roles,
    permissions,
    loading,
    hydrated,

    isEnabled,
    orgId,
    orgName,
    memberCount,
    departmentCount,
    teamCount,
    pendingInviteCount,

    enable,
    disable,
    updateOrg,
    fetchAll,
    fetchActivity,
    fetchRoles,

    addMember,
    updateMember,
    removeMember,
    assignMemberRole,

    createRole,
    updateRole,
    removeRole,

    addDepartment,
    updateDepartment,
    removeDepartment,

    addTeam,
    updateTeam,
    removeTeam,

    addTeamMember,
    removeTeamMember,

    addInvite,
    revokeInvite,
    acceptInvite,
    getInviteInfo,

    getMemberById,
    getDepartmentById,
    getTeamById,
    getRoleById,
    getRoleByName,
    getMemberRole,
    getMembersByDepartment,
    getTeamsByDepartment,
    getTeamMembers,

    onProfileSwitch,

    managedSettings,
    managedProviders,
    isManagedSettingsAdmin,
    fetchManagedSettings,
  }
})
