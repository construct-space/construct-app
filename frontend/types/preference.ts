// Preference types for user preferences (toolbar state, UI settings, etc.)

export interface Preference {
  id: number
  key: string
  value: unknown
  user_id?: number
  created_at: string
  updated_at: string
}

// Common preference keys
export type PreferenceKey =
  | 'toolbar.collapsed'
  | 'toolbar.position'
  | 'toolbar.items'
  | 'sidebar.width'
  | 'sidebar.collapsed'
  | 'theme'
  | 'locale'
  | 'editor.settings'
  | string // Allow custom keys

// Editor settings preferences
export interface EditorSettings {
  theme: string
  fontSize: number
  fontFamily: string
  fontLigatures: boolean
  minimap: boolean
  lineNumbers: 'on' | 'off' | 'relative'
  wordWrap: 'on' | 'off' | 'bounded'
  renderWhitespace: 'none' | 'selection' | 'all'
  renderLineHighlight: 'none' | 'gutter' | 'line' | 'all'
  tabSize: number
  insertSpaces: boolean
  cursorStyle: string
  cursorBlinking: string
  cursorSmoothCaretAnimation: boolean
  smoothScrolling: boolean
  mouseWheelZoom: boolean
  formatOnPaste: boolean
  autoClosingBrackets: string
  bracketPairColorization: boolean
  folding: boolean
  links: boolean
  colorDecorators: boolean
}

// Toolbar-specific preferences
export interface ToolbarPreferences {
  collapsed: boolean
  position: 'top' | 'bottom' | 'left' | 'right'
  items: string[]
}

// Sidebar-specific preferences
export interface SidebarPreferences {
  width: number
  collapsed: boolean
}

// Notification preferences
export interface NotificationPreferences {
  email: boolean
  desktop: boolean
  product_updates: boolean
  weekly_digest: boolean
  important_updates: boolean
}
