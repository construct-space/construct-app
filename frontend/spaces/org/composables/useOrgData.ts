import { computed } from 'vue'
import { useOrgStore } from '@/stores/org'
import type { ActivityEntry, Department, OrgMember, OrgRole, Team } from '@/types/org'

export function useOrgData() {
  const store = useOrgStore()

  // Auto-fetch on first use if org is enabled but data hasn't been loaded yet
  if (store.isEnabled && !store.hydrated && !store.loading) {
    store.fetchAll()
  }

  const org = computed(() => store.currentOrg)
  const members = computed(() => store.members)
  const departments = computed(() => store.departments)
  const teams = computed(() => store.teams)
  const teamMembers = computed(() => store.teamMembers)
  const invites = computed(() => store.invites)
  const activity = computed(() => store.activity)
  const activityTotal = computed(() => store.activityTotal)
  const roles = computed(() => store.roles)
  const permissions = computed(() => store.permissions)
  const isEnabled = computed(() => store.isEnabled)
  const orgId = computed(() => store.orgId)
  const orgName = computed(() => store.orgName)
  const loading = computed(() => store.loading)

  const stats = computed(() => ({
    memberCount: store.memberCount,
    departmentCount: store.departmentCount,
    teamCount: store.teamCount,
    pendingInviteCount: store.pendingInviteCount,
  }))

  async function fetchAll(): Promise<void> {
    return store.fetchAll()
  }

  async function createMember(data: { name: string; email: string; role?: string; department_id?: string; title?: string }): Promise<OrgMember | null> {
    return store.addMember({
      user_id: '',
      name: data.name,
      email: data.email,
      avatar: '',
      title: data.title ?? '',
      phone: '',
      bio: '',
      role: data.role ?? 'member',
      role_id: null,
      status: 'active',
      department_id: data.department_id ?? null,
    })
  }

  async function updateMember(id: string, changes: Partial<OrgMember>): Promise<OrgMember | null> {
    return store.updateMember(id, changes)
  }

  async function deleteMember(id: string): Promise<boolean> {
    return store.removeMember(id)
  }

  function getMemberById(id: string): OrgMember | undefined {
    return store.getMemberById(id)
  }

  function getMemberName(id: string): string {
    return store.getMemberById(id)?.name ?? 'Unknown'
  }

  function getMembersByDepartment(deptId: string): OrgMember[] {
    return store.getMembersByDepartment(deptId)
  }

  function searchMembers(query: string): OrgMember[] {
    const q = query.toLowerCase()
    return store.members.filter(m =>
      m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    )
  }

  async function createDepartment(data: { name: string; description?: string; code?: string; head_id?: string }): Promise<Department | null> {
    return store.addDepartment({
      name: data.name,
      description: data.description ?? '',
      code: data.code ?? '',
      head_id: data.head_id ?? null,
    })
  }

  async function updateDepartment(id: string, changes: Partial<Department>): Promise<Department | null> {
    return store.updateDepartment(id, changes)
  }

  async function deleteDepartment(id: string): Promise<boolean> {
    return store.removeDepartment(id)
  }

  function getDepartmentById(id: string): Department | undefined {
    return store.getDepartmentById(id)
  }

  function getDepartmentName(id: string): string {
    return store.getDepartmentById(id)?.name ?? 'Unknown'
  }

  async function createTeam(data: { name: string; description?: string; department_id: string; lead_id?: string }): Promise<Team | null> {
    return store.addTeam({
      name: data.name,
      description: data.description ?? '',
      department_id: data.department_id,
      lead_id: data.lead_id ?? null,
    })
  }

  async function updateTeam(id: string, changes: Partial<Team>): Promise<Team | null> {
    return store.updateTeam(id, changes)
  }

  async function deleteTeam(id: string): Promise<boolean> {
    return store.removeTeam(id)
  }

  function getTeamById(id: string): Team | undefined {
    return store.getTeamById(id)
  }

  function getTeamsByDepartment(deptId: string): Team[] {
    return store.getTeamsByDepartment(deptId)
  }

  function getTeamMembers(teamId: string): OrgMember[] {
    return store.getTeamMembers(teamId)
  }

  async function addMemberToTeam(teamId: string, memberId: string): Promise<void> {
    await store.addTeamMember(teamId, memberId)
  }

  async function removeMemberFromTeam(teamId: string, memberId: string): Promise<void> {
    await store.removeTeamMember(teamId, memberId)
  }

  function getMemberTeams(memberId: string): Team[] {
    const teamIds = store.teamMembers
      .filter(tm => tm.member_id === memberId)
      .map(tm => tm.team_id)
    return store.teams.filter(t => teamIds.includes(t.id))
  }

  async function sendInvite(data: { email: string; role: string; department_id?: string }): Promise<void> {
    await store.addInvite({
      email: data.email,
      role: data.role,
      department_id: data.department_id ?? null,
      invited_by: 'current-user',
    })
  }

  async function revokeInvite(id: string): Promise<void> {
    await store.revokeInvite(id, 'current-user')
  }

  async function acceptInvite(token: string): Promise<OrgMember | null> {
    return store.acceptInvite(token)
  }

  function recentActivity(limit = 20): ActivityEntry[] {
    return store.activity.slice(0, limit)
  }

  async function enableOrg(name: string): Promise<void> {
    await store.enable(name)
  }

  async function disableOrg(): Promise<void> {
    await store.disable()
  }

  async function fetchRoles(): Promise<void> {
    return store.fetchRoles()
  }

  async function createRole(data: { name: string; description: string; permissions: string[] }): Promise<OrgRole | null> {
    return store.createRole(data)
  }

  async function updateRole(id: string, updates: { name?: string; description?: string; permissions?: string[] }): Promise<OrgRole | null> {
    return store.updateRole(id, updates)
  }

  async function deleteRole(id: string): Promise<boolean> {
    return store.removeRole(id)
  }

  async function assignMemberRole(memberId: string, roleId: string): Promise<OrgMember | null> {
    return store.assignMemberRole(memberId, roleId)
  }

  function getRoleById(id: string): OrgRole | undefined {
    return store.getRoleById(id)
  }

  function getMemberRole(member: OrgMember): OrgRole | undefined {
    return store.getMemberRole(member)
  }

  return {
    org,
    members,
    departments,
    teams,
    teamMembers,
    invites,
    activity,
    activityTotal,
    roles,
    permissions,
    isEnabled,
    orgId,
    orgName,
    stats,
    loading,

    fetchAll,

    createMember,
    updateMember,
    deleteMember,
    getMemberById,
    getMemberName,
    getMembersByDepartment,
    searchMembers,

    createDepartment,
    updateDepartment,
    deleteDepartment,
    getDepartmentById,
    getDepartmentName,

    createTeam,
    updateTeam,
    deleteTeam,
    getTeamById,
    getTeamsByDepartment,
    getTeamMembers,
    addMemberToTeam,
    removeMemberFromTeam,
    getMemberTeams,

    sendInvite,
    revokeInvite,
    acceptInvite,

    recentActivity,
    fetchActivity: store.fetchActivity,

    fetchRoles,
    createRole,
    updateRole,
    deleteRole,
    assignMemberRole,
    getRoleById,
    getMemberRole,

    enableOrg,
    disableOrg,
  }
}
