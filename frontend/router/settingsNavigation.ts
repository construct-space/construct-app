import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import {
  Activity,
  BarChart3,
  Boxes,
  Briefcase,
  Brush,
  Building2,
  CircleUser,
  Code,
  Code2,
  Cpu,
  Bell,
  BrainCircuit,
  Mail,
  Monitor,
  Puzzle,
  Zap,
  Shield,
  Users,
  Webhook,
} from 'lucide-vue-next'

export const SETTINGS_DEFAULT_PATH = '/app/settings/profile'

type SettingsGroup = 'Organization' | 'Account' | 'General' | 'AI'

interface SettingsDefinition {
  label: string
  path: string
  group: SettingsGroup
  icon: Component
  component: () => Promise<unknown>
  devOnly?: boolean
  orgOnly?: boolean
  adminOnly?: boolean
  personalOnly?: boolean
  // Required org roles. ORed: any one role grants access. Used by the Org
  // Developer page, which owners/admins/developers manage but other
  // members shouldn't see in the nav.
  orgRoles?: string[]
}

const settingsDefinitions: SettingsDefinition[] = [
  // Organisation — admin-only (visible when in org + admin/owner)
  { label: 'Organization', path: 'org-profile', group: 'Organization', icon: Building2, component: () => import('@/spaces/org/pages/OrgSettings.vue'), orgOnly: true, adminOnly: true },
  { label: 'Members', path: 'org-members', group: 'Organization', icon: Users, component: () => import('@/spaces/org/pages/OrgMembers.vue'), orgOnly: true, adminOnly: true },
  { label: 'Roles', path: 'org-roles', group: 'Organization', icon: Shield, component: () => import('@/spaces/org/pages/OrgRoles.vue'), orgOnly: true, adminOnly: true },
  { label: 'Departments', path: 'org-departments', group: 'Organization', icon: Briefcase, component: () => import('@/spaces/org/pages/OrgDepartments.vue'), orgOnly: true, adminOnly: true },
  { label: 'Spaces', path: 'org-spaces', group: 'Organization', icon: Boxes, component: () => import('@/spaces/org/pages/OrgSpaces.vue'), orgOnly: true, adminOnly: true },
  { label: 'Invitations', path: 'org-invitations', group: 'Organization', icon: Mail, component: () => import('@/spaces/org/pages/OrgInvitations.vue'), orgOnly: true, adminOnly: true },
  { label: 'Activity', path: 'org-activity', group: 'Organization', icon: Activity, component: () => import('@/spaces/org/pages/OrgActivity.vue'), orgOnly: true, adminOnly: true },
  { label: 'Developer', path: 'org-developer', group: 'Organization', icon: Code2, component: () => import('@/spaces/org/pages/OrgDeveloper.vue'), orgOnly: true, orgRoles: ['owner', 'admin', 'developer'] },

  // Account — always visible
  { label: 'Profile', path: 'profile', group: 'Account', icon: CircleUser, component: () => import('@/pages/settings/ProfileSettings.vue') },
  { label: 'Privacy', path: 'privacy', group: 'Account', icon: Shield, component: () => import('@/pages/settings/PrivacySettings.vue') },
  { label: 'Notifications', path: 'notifications', group: 'Account', icon: Bell, component: () => import('@/pages/settings/NotificationsSettings.vue') },

  // General
  { label: 'Appearance', path: 'appearance', group: 'General', icon: Brush, component: () => import('@/pages/settings/AppearanceSettings.vue') },
  { label: 'System', path: 'system', group: 'General', icon: Monitor, component: () => import('@/pages/settings/SystemSettings.vue') },
  { label: 'Developer', path: 'developer', group: 'General', icon: Code, component: () => import('@/pages/settings/DeveloperSettings.vue') },
  { label: 'Organization', path: 'organization', group: 'General', icon: Building2, component: () => import('@/pages/settings/OrganizationSettings.vue'), personalOnly: true },
  { label: 'Insights', path: 'insights', group: 'General', icon: BarChart3, component: () => import('@/pages/settings/InsightsSettings.vue') },

  // AI
  { label: 'Providers', path: 'llms', group: 'AI', icon: Cpu, component: () => import('@/pages/settings/LLMProviders.vue') },
  { label: 'Skills', path: 'skills', group: 'AI', icon: Puzzle, component: () => import('@/pages/settings/SkillsSettings.vue') },
  { label: 'Memory', path: 'memory', group: 'AI', icon: BrainCircuit, component: () => import('@/pages/settings/MemorySettings.vue') },
  { label: 'Automations', path: 'automations', group: 'AI', icon: Zap, component: () => import('@/pages/settings/AutomationsSettings.vue') },
  { label: 'Hooks', path: 'hooks', group: 'AI', icon: Webhook, component: () => import('@/pages/settings/HooksSettings.vue'), devOnly: true },
]

export interface SettingsNavItem {
  label: string
  path: string
  icon: Component
}

export interface SettingsNavGroup {
  label: SettingsGroup
  items: SettingsNavItem[]
}

const groupOrder: SettingsGroup[] = ['Organization', 'Account', 'General', 'AI']

// Members page has tabs: Members, Invitations, Roles & Permissions

interface NavOptions {
  isDeveloper?: boolean
  isOrg?: boolean
  isAdmin?: boolean
  // Lowercase role keys held by the current user in the active org.
  // Compared against item.orgRoles to gate role-restricted entries
  // (currently the Org Developer page).
  orgRoles?: string[]
}

export function getSettingsNavGroups(isDeveloperOrOptions?: boolean | NavOptions): SettingsNavGroup[] {
  let opts: NavOptions
  if (typeof isDeveloperOrOptions === 'object') {
    opts = isDeveloperOrOptions
  } else {
    opts = { isDeveloper: isDeveloperOrOptions ?? false }
  }
  const userRoles = new Set((opts.orgRoles || []).map(role => role.trim().toLowerCase()))

  return groupOrder
    .map((group) => {
      const items = settingsDefinitions
        .filter(item => {
          if (item.devOnly && !opts.isDeveloper) return false
          if (item.orgOnly && !opts.isOrg) return false
          if (item.adminOnly && !opts.isAdmin) return false
          if (item.personalOnly && opts.isOrg) return false
          if (item.orgRoles && !item.orgRoles.some(r => userRoles.has(r))) return false
          return item.group === group
        })
        .map(item => ({
          label: item.label,
          path: `/app/settings/${item.path}`,
          icon: item.icon,
        }))
      return { label: group, items }
    })
    .filter(group => group.items.length > 0)
}

export const allSettingsNavItems = settingsDefinitions.map(item => ({
  label: item.label,
  path: `/app/settings/${item.path}`,
  icon: item.icon,
}))

export const settingsRouteChildren: RouteRecordRaw[] = settingsDefinitions.map(item => ({
  path: item.path,
  component: item.component,
}))
