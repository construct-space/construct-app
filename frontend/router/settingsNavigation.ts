import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import {
  Brush,
  CircleUser,
  Code,
  Cpu,
  Download,
  FolderOpen,
  Globe,
  Image,
  Keyboard,
  Monitor,
  Puzzle,
  Server,
  Shield,
} from 'lucide-vue-next'

export const SETTINGS_DEFAULT_PATH = '/app/settings/profile'

type SettingsGroup = 'Account' | 'General' | 'AI'

interface SettingsDefinition {
  label: string
  path: string
  group: SettingsGroup
  icon: Component
  component: () => Promise<unknown>
}

const settingsDefinitions: SettingsDefinition[] = [
  { label: 'Profile', path: 'profile', group: 'Account', icon: CircleUser, component: () => import('@/pages/settings/ProfileSettings.vue') },
  { label: 'Privacy', path: 'privacy', group: 'Account', icon: Shield, component: () => import('@/pages/settings/PrivacySettings.vue') },

  { label: 'Projects', path: 'projects', group: 'General', icon: FolderOpen, component: () => import('@/pages/settings/ProjectsSettings.vue') },
  { label: 'Appearance', path: 'appearance', group: 'General', icon: Brush, component: () => import('@/pages/settings/AppearanceSettings.vue') },
  { label: 'Shortcuts', path: 'shortcuts', group: 'General', icon: Keyboard, component: () => import('@/pages/settings/ShortcutsSettings.vue') },
  { label: 'Updates', path: 'updates', group: 'General', icon: Download, component: () => import('@/pages/settings/UpdatesSettings.vue') },
  { label: 'System', path: 'system', group: 'General', icon: Monitor, component: () => import('@/pages/settings/SystemSettings.vue') },
  { label: 'Developer', path: 'developer', group: 'General', icon: Code, component: () => import('@/pages/settings/DeveloperSettings.vue') },

  { label: 'LLMs & Models', path: 'llms', group: 'AI', icon: Cpu, component: () => import('@/pages/settings/LLMSettings.vue') },
  { label: 'Media & AI', path: 'media', group: 'AI', icon: Image, component: () => import('@/pages/settings/MediaSettings.vue') },
  { label: 'MCP Servers', path: 'mcp', group: 'AI', icon: Server, component: () => import('@/pages/settings/MCPSettings.vue') },
  { label: 'Skills & Hooks', path: 'skills', group: 'AI', icon: Puzzle, component: () => import('@/pages/settings/SkillsSettings.vue') },
  { label: 'Browser Automation', path: 'browser', group: 'AI', icon: Globe, component: () => import('@/pages/settings/BrowserSettings.vue') },
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

const groupOrder: SettingsGroup[] = ['Account', 'General', 'AI']

export const settingsNavGroups: SettingsNavGroup[] = groupOrder
  .map((group) => {
    const items = settingsDefinitions
      .filter(item => item.group === group)
      .map(item => ({
        label: item.label,
        path: `/app/settings/${item.path}`,
        icon: item.icon,
      }))

    return { label: group, items }
  })
  .filter(group => group.items.length > 0)

export const allSettingsNavItems = settingsNavGroups.flatMap(group => group.items)

export const settingsRouteChildren: RouteRecordRaw[] = settingsDefinitions.map(item => ({
  path: item.path,
  component: item.component,
}))
