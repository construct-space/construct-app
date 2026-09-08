export type MemberStatus = 'active' | 'inactive' | 'pending_invite'

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'


export interface Organization {
  id: string
  name: string
  slug: string
  icon: string
  owner_id: string
  developer_status: string
  created_at: string
  updated_at: string
}

export interface OrgMember {
  id: string
  org_id: string
  user_id: string
  name: string
  email: string
  avatar: string
  title: string
  phone: string
  bio: string
  role: string
  role_id: string | null
  status: MemberStatus
  department_id: string | null
  joined_at: string
  last_active_at: string
  created_at: string
  updated_at: string
}

export interface OrgInvite {
  id: string
  org_id: string
  email: string
  role: string
  department_id: string | null
  invited_by: string
  token: string
  status: InviteStatus
  expires_at: string
  created_at: string
  updated_at: string
}

export interface Department {
  id: string
  org_id: string
  name: string
  description: string
  code: string
  head_id: string | null
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  org_id: string
  name: string
  description: string
  department_id: string | null
  lead_id: string | null
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: number
  team_id: string
  member_id: string
  joined_at: string
}

export interface ActivityEntry {
  id: string
  org_id: string
  action: string
  resource_type: string
  resource_id: string
  resource_name: string
  performed_by: string
  changes: string
  created_at: string
}

export interface OrgSettings {
  enabled: boolean
  org_id: string
  org_name: string
}

// --- Roles & Permissions ---

export interface OrgRole {
  id: string
  org_id: string
  name: string
  description: string
  is_builtin: boolean
  permissions: string[]
  created_at: string
  updated_at: string
}

export interface PermissionDef {
  id: string
  label: string
  group: string
  // Optional sub-label rendered below `label` on the roles settings
  // page — populated when the /org/permissions endpoint includes it.
  description?: string
}

export interface MembershipInfo {
  org_id: string
  org_name: string
  org_slug: string
  org_icon: string
  role: string
  member_id: string
  developer_status: string
}

export interface ManagedSettingsBundle {
  org_id: string
  org_name: string
  manageable: boolean
  providers: OrgProviderEntry[]
  settings: Record<string, string>
}

export interface OrgProviderEntry {
  id: string
  provider: string
  set_by: string
}

export interface ActivityResponse {
  data: ActivityEntry[]
  total: number
}
