/**
 * Global Toolbar Configuration
 *
 * Defines the default toolbar layout that applies to all spaces.
 * Items before 'flexible-space' are global (breadcrumb, navigation).
 * Space-specific items are injected after 'flexible-space'.
 * Items after space items are app-level (notifications, settings, ai).
 *
 * Layout: [global] [flexible-space] [space items] [separator] [app items]
 */

import type { ToolbarItem } from '~/composables/useToolbar'

// Global toolbar items - available in all contexts
export const globalToolbarItems: Omit<ToolbarItem, 'onClick' | 'disabled' | 'active'>[] = [
  // Navigation (left side)
  { id: 'breadcrumb', icon: 'i-lucide-navigation', label: 'Breadcrumb', type: 'breadcrumb', category: 'navigation' },
  { id: 'back', icon: 'i-lucide-chevron-left', label: 'Back', type: 'action', category: 'navigation' },
  { id: 'forward', icon: 'i-lucide-chevron-right', label: 'Forward', type: 'action', category: 'navigation' },
  { id: 'home', icon: 'i-lucide-home', label: 'Home', type: 'action', category: 'navigation' },
  { id: 'refresh', icon: 'i-lucide-refresh-cw', label: 'Refresh', type: 'action', category: 'navigation' },

  // App actions (right side, after space items)
  { id: 'search', icon: 'i-lucide-search', label: 'Search', type: 'action', category: 'app' },
  { id: 'notifications', icon: 'i-lucide-bell', label: 'Notifications', type: 'action', category: 'app' },
  { id: 'settings', icon: 'i-lucide-settings', label: 'Settings', type: 'action', category: 'app' },
  { id: 'ai-assistant', icon: 'i-lucide-sparkles', label: 'AI Assistant', type: 'action', category: 'app' },
  { id: 'help', icon: 'i-lucide-help-circle', label: 'Help', type: 'action', category: 'app' },
  { id: 'share', icon: 'i-lucide-share', label: 'Share', type: 'action', category: 'app' },
  { id: 'download', icon: 'i-lucide-download', label: 'Download', type: 'action', category: 'app' },
  { id: 'upload', icon: 'i-lucide-upload', label: 'Upload', type: 'action', category: 'app' },
  { id: 'fullscreen', icon: 'i-lucide-maximize', label: 'Fullscreen', type: 'action', category: 'app' },
  { id: 'sidebar', icon: 'i-lucide-panel-left', label: 'Sidebar', type: 'action', category: 'app' },

  // Utility items (can be placed anywhere)
  { id: 'separator', icon: '', label: 'Separator', type: 'separator', category: 'utility' },
  { id: 'flexible-space', icon: '', label: 'Flexible Space', type: 'flexible-space', category: 'utility' },
]

// Default toolbar layout
// Format: [navigation] [separator] [search] [flexible-space] [SPACE ITEMS GO HERE] [app items]
export const defaultToolbarLayout = [
  'breadcrumb',
  'separator',
  'back',
  'forward',
  'separator',
  'search',
  'flexible-space',  // Space-specific items are injected after this
  'notifications',
  'settings',
  'ai-assistant'
]

export default {
  items: globalToolbarItems,
  layout: defaultToolbarLayout
}
