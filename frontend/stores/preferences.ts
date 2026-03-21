import { defineStore } from 'pinia'
import { useSource } from '@/composables/useSource'
import type { PreferenceKey, EditorSettings } from '~/types/preference'

// Default editor settings
const defaultEditorSettings: EditorSettings = {
  theme: 'auto',
  fontSize: 14,
  fontFamily: 'JetBrains Mono',
  fontLigatures: true,
  minimap: true,
  lineNumbers: 'on',
  wordWrap: 'on',
  renderWhitespace: 'selection',
  renderLineHighlight: 'all',
  tabSize: 2,
  insertSpaces: true,
  cursorStyle: 'line',
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: true,
  smoothScrolling: true,
  mouseWheelZoom: true,
  formatOnPaste: true,
  autoClosingBrackets: 'languageDefined',
  bracketPairColorization: true,
  folding: true,
  links: true,
  colorDecorators: true,
}

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    preferences: {} as Record<string, unknown>,
    loading: false,
    initialized: false,
    error: null as string | null
  }),

  getters: {
    // Get a specific preference value
    get: (state) => <T>(key: PreferenceKey, defaultValue: T): T => {
      const value = state.preferences[key]
      return value !== undefined ? value as T : defaultValue
    },

    // Toolbar preferences
    toolbarCollapsed: (state) => state.preferences['toolbar.collapsed'] as boolean ?? false,
    toolbarPosition: (state) => state.preferences['toolbar.position'] as string ?? 'top',
    toolbarItems: (state) => state.preferences['toolbar.items'] as string[] ?? [],

    // Sidebar preferences
    sidebarWidth: (state) => state.preferences['sidebar.width'] as number ?? 280,
    sidebarCollapsed: (state) => state.preferences['sidebar.collapsed'] as boolean ?? false,

    // Theme preferences
    theme: (state) => state.preferences['theme'] as string ?? 'dark',

    // Editor preferences
    editorSettings: (state): EditorSettings => {
      const saved = state.preferences['editor.settings'] as Partial<EditorSettings> | undefined
      return { ...defaultEditorSettings, ...saved }
    }
  },

  actions: {
    async fetchPreferences() {
      const authStore = useAuthStore()
      if (!authStore.isAuthenticated || !authStore.token) {
        return {}
      }

      this.loading = true
      this.error = null

      try {
        const source = useSource()
        const response = await source.get<{ data: Record<string, unknown> }>('/preferences')
        this.preferences = response.data || {}
        this.initialized = true
        return this.preferences
      } catch (error) {
        const msg = (error as Error).message || ''
        // 404 means endpoint doesn't exist yet — not an error
        if (!msg.includes('404')) {
          this.error = msg || 'Failed to fetch preferences'
          console.error('Failed to load preferences:', this.error)
        }
        return {}
      } finally {
        this.loading = false
      }
    },

    async setPreference<T>(key: PreferenceKey, value: T) {
      this.error = null

      // Optimistic update
      const backup = this.preferences[key]
      this.preferences[key] = value

      try {
        const source = useSource()
        await source.put(`/preferences/${key}`, { value })
        return { success: true }
      } catch (error) {
        // Rollback on error
        this.preferences[key] = backup
        this.error = (error as Error).message || 'Failed to save preference'
        return { success: false, error: this.error }
      }
    },

    // Toolbar-specific actions
    async setToolbarCollapsed(collapsed: boolean) {
      return this.setPreference('toolbar.collapsed', collapsed)
    },

    async setToolbarPosition(position: string) {
      return this.setPreference('toolbar.position', position)
    },

    async setToolbarItems(items: string[]) {
      return this.setPreference('toolbar.items', items)
    },

    // Sidebar-specific actions
    async setSidebarWidth(width: number) {
      return this.setPreference('sidebar.width', width)
    },

    async setSidebarCollapsed(collapsed: boolean) {
      return this.setPreference('sidebar.collapsed', collapsed)
    },

    // Theme action
    async setTheme(theme: string) {
      return this.setPreference('theme', theme)
    },

    // Editor settings action
    async setEditorSettings(settings: Partial<EditorSettings>) {
      const current = this.editorSettings
      const merged = { ...current, ...settings }
      return this.setPreference('editor.settings', merged)
    },

    // Initialize on app load
    async init() {
      if (!this.initialized) {
        const authStore = useAuthStore()
        if (!authStore.isAuthenticated || !authStore.token) {
          return
        }
        await this.fetchPreferences()
      }
    }
  }
})
