import { defineStore } from 'pinia'
import { useSource } from '@/composables/useSource'

/**
 * Org-scoped preferences / policies.
 *
 * Where this differs from `usePreferencesStore`:
 *   - Backed by source (`/api/source/org/preferences`), not accounts. User
 *     preferences live on accounts; org policies live on source because the
 *     org itself lives there.
 *   - Every authenticated org member can GET; only users with
 *     `org.settings.edit` can PUT. We surface the 403 as a non-optimistic
 *     error so the UI can tell the user to ask an admin.
 *   - If the caller has no org, source returns 404; we swallow it and
 *     behave as if the bag is empty.
 *   - Typed convenience getters cover the v1 policy keys the app needs to
 *     branch on (invite role default, 2FA requirement, default project
 *     visibility, allow member OAuth). Everything else still flows through
 *     the generic `get(key, default)` getter.
 */
export type DefaultProjectVisibility = 'private' | 'internal' | 'public'

export const useOrgPreferencesStore = defineStore('orgPreferences', {
  state: () => ({
    preferences: {} as Record<string, unknown>,
    loading: false,
    initialized: false,
    error: null as string | null,
  }),

  getters: {
    get: (state) => <T>(key: string, defaultValue: T): T => {
      const value = state.preferences[key]
      return value !== undefined ? (value as T) : defaultValue
    },

    inviteRoleDefault: (state): string => {
      const value = state.preferences['members.invite_role_default']
      return typeof value === 'string' ? value : 'member'
    },

    requireTwoFactor: (state): boolean => {
      const value = state.preferences['members.require_2fa']
      return value === true
    },

    defaultProjectVisibility: (state): DefaultProjectVisibility => {
      const value = state.preferences['projects.default_visibility']
      if (value === 'private' || value === 'internal' || value === 'public') {
        return value
      }
      return 'private'
    },

    allowMemberOAuth: (state): boolean => {
      const value = state.preferences['providers.allow_member_oauth']
      // Default: true — if policy isn't set, members can connect personal OAuth.
      if (value === undefined || value === null) return true
      return value !== false
    },
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
        const response = await source.get<{ data: Record<string, unknown> }>('/org/preferences')
        this.preferences = response.data || {}
        this.initialized = true
        return this.preferences
      } catch (error) {
        const msg = (error as Error).message || ''
        // 404 → caller has no org; treat as empty bag.
        if (msg.includes('404')) {
          this.preferences = {}
          this.initialized = true
          return {}
        }
        this.error = msg || 'Failed to fetch org preferences'
        console.error('Failed to load org preferences:', this.error)
        return {}
      } finally {
        this.loading = false
      }
    },

    async setPreference<T>(key: string, value: T) {
      this.error = null

      // Non-optimistic: only mutate local state after the server confirms.
      // A 403 here means the caller lacks org.settings.edit; surface it.
      try {
        const source = useSource()
        await source.put(`/org/preferences/${key}`, { value })
        this.preferences[key] = value as unknown
        return { success: true as const }
      } catch (error) {
        const msg = (error as Error).message || ''
        if (msg.includes('403')) {
          this.error = 'Only admins/owners can change this policy.'
        } else {
          this.error = msg || 'Failed to save org preference'
        }
        return { success: false as const, error: this.error }
      }
    },

    async init() {
      if (!this.initialized) {
        const authStore = useAuthStore()
        if (!authStore.isAuthenticated || !authStore.token) return
        await this.fetchPreferences()
      }
    },
  },
})
