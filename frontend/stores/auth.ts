import { defineStore } from 'pinia'
import { appConfig } from '@/utils/config'
import type { AuthUserData } from '@/types'

interface AuthState {
  user: AuthUserData | null
  token: string | null
  oauthToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

const isContextNotConnectedError = (error: unknown): boolean =>
  String(error).toLowerCase().includes('not connected')

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    token: null,
    oauthToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  }),

  getters: {
    currentUser: (state) => state.user,
    userName: (state) => state.user?.name || 'User',
    userEmail: (state) => state.user?.email || '',
    userAvatar: (state) => state.user?.avatar || null,
  },

  actions: {
    async syncTokenToContextService(token?: string | null, user?: AuthUserData | null) {
      const syncToken = token || this.token
      const syncUser = user || this.user
      if (!syncToken || !syncUser) return

      try {
        const { useOperator } = await import('@/operator')
        const operator = useOperator()
        if (!operator.isTauri.value) return

        const apiBaseUrl = appConfig.apiBase
        const baseUrl = apiBaseUrl.replace(/\/api$/, '')

        let lastError: unknown = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await operator.connect()
            await operator.send('auth.set_api_base', { baseUrl })
            await operator.send('auth.sync_token', {
              token: syncToken,
              userId: String(syncUser.id || ''),
              userJson: JSON.stringify(syncUser),
            })
            return
          } catch (error) {
            lastError = error
            if (!isContextNotConnectedError(error) || attempt === 2) {
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
        }

        if (lastError && !isContextNotConnectedError(lastError)) {
          import('@/composables/useLogger').then(({ getLogger }) => getLogger().then(l => l.warn(`Failed to sync token to context service: ${lastError}`))).catch(() => {})
        }
      } catch {
        // Context service composable not available yet — safe to ignore
      }
    },

    async loginWithOAuth(code: string) {
      this.isLoading = true
      this.error = null

      try {
        const { useConstructAuth } = await import('@/composables/useConstructAuth')
        const constructAuth = useConstructAuth()

        // Exchange code for API JWT + OAuth token
        const tokenData = await constructAuth.exchangeCode(code)
        const apiToken = tokenData.access_token // JWT for API calls
        const oauthToken = tokenData.oauth_token || apiToken // OAuth token for accounts service

        this.token = apiToken
        this.oauthToken = oauthToken

        const { useApi } = await import('@/composables/useApi')
        const api = useApi()
        api.setToken(apiToken)

        // Fetch user profile using OAuth token (proxied through local API)
        const profile = await constructAuth.fetchProfile(oauthToken)

        const userData: AuthUserData = {
          id: typeof profile.id === 'string' ? parseInt(profile.id, 10) || 0 : profile.id as number,
          email: profile.email,
          username: profile.username,
          first_name: profile.first_name,
          last_name: profile.last_name,
          name: `${profile.first_name} ${profile.last_name}`.trim(),
          avatar: profile.avatar_url,
          created_at: '',
          updated_at: '',
        }

        this.user = userData
        this.isAuthenticated = true

        await this.persistAuthState()
        await this.syncTokenToContextService(apiToken, userData)

        return { success: true as const, data: userData }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Login failed'
        this.clearAuthState()
        this.error = errorMessage
        return { success: false as const, error: errorMessage }
      } finally {
        this.isLoading = false
      }
    },

    async logout() {
      this.isLoading = true

      const { useApi } = await import('@/composables/useApi')
      const api = useApi()
      api.removeToken()
      this.clearAuthState()
      this.clearPersistedState()

      // Clear all user-scoped data so a new login starts fresh
      localStorage.removeItem('cp_tasks')
      localStorage.removeItem('cp_pinned_items')
      // Clear per-user onboarding flag
      const userId = this.user?.id || this.user?.email || 'unknown'
      localStorage.removeItem(`cp_onboarding_complete:${userId}`)
      localStorage.removeItem('cp_onboarding_complete') // legacy cleanup

      // Clear pinned items from SQLite (Tauri)
      try {
        const { usePinnedStore } = await import('@/stores/pinned')
        const pinnedStore = usePinnedStore()
        await pinnedStore.clearAll()
      } catch {
        // Safe to ignore if store not ready
      }

      this.isLoading = false
    },

    async checkAuth() {
      if (!this.token) {
        this.hydrateAuthState()
      }

      if (!this.token) {
        return false
      }

      if (!this.user) {
        this.clearAuthState()
        this.clearPersistedState()
        return false
      }

      // Validate token against accounts service
      const { useApi } = await import('@/composables/useApi')
      const api = useApi()
      api.setToken(this.token)

      try {
        const { useConstructAuth } = await import('@/composables/useConstructAuth')
        const constructAuth = useConstructAuth()
        // Use OAuth token for profile validation (API JWT won't work against accounts service)
        const profileToken = this.oauthToken || this.token
        await constructAuth.fetchProfile(profileToken!)
        this.isAuthenticated = true
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : ''
        const isNetworkError = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')

        if (isNetworkError) {
          // Server unreachable — trust local state
          console.info('[Auth] Server unreachable, keeping local session')
          this.isAuthenticated = true
        } else {
          // Token rejected or other error — clear auth
          console.warn('[Auth] checkAuth failed, clearing session:', msg)
          this.clearAuthState()
          this.clearPersistedState()
          return false
        }
      }

      return this.isAuthenticated
    },

    clearAuthState() {
      this.user = null
      this.token = null
      this.oauthToken = null
      this.isAuthenticated = false
      this.error = null
    },

    async persistAuthState() {
      if (typeof window === 'undefined') return

      // auth.json file in data dir — single source of truth (shared with CLI/operator)
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (!isTauriEnv()) return

        const { invoke } = await import('@tauri-apps/api/core')
        const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')

        const baseDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
        if (!await exists(baseDir)) {
          await mkdir(baseDir, { recursive: true })
        }

        const authFile = {
          user: this.user,
          token: this.token,
          oauth_token: this.oauthToken,
          authenticated: this.isAuthenticated,
          updated_at: new Date().toISOString(),
        }

        await writeTextFile(`${baseDir}/auth.json`, JSON.stringify(authFile, null, 2))
      } catch {
        // File persistence is best-effort
      }
    },

    _applyAuthState(authState: {
      user: AuthUserData | null
      token: string | null
      oauthToken?: string | null
      isAuthenticated: boolean
    }, { setAuthenticated = true } = {}) {
      this.user = authState.user
      this.token = authState.token
      this.oauthToken = authState.oauthToken || null
      if (setAuthenticated) {
        this.isAuthenticated = authState.isAuthenticated
      }

    },

    async hydrateAuthState() {
      if (typeof window === 'undefined') return

      try {
        // Read from auth.json — single source of truth
        // Restore token/user but DON'T set isAuthenticated yet.
        // checkAuth() will set it after server validation.
        try {
          const { isTauriEnv } = await import('@/utils/tauri')
          if (isTauriEnv()) {
            const { invoke } = await import('@tauri-apps/api/core')
            const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
            const baseDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
            const authPath = `${baseDir}/auth.json`
            if (await exists(authPath)) {
              const raw = await readTextFile(authPath)
              const fileAuth = JSON.parse(raw)
              if (fileAuth.token) {
                this._applyAuthState({
                  user: fileAuth.user,
                  token: fileAuth.token,
                  oauthToken: fileAuth.oauth_token,
                  isAuthenticated: fileAuth.authenticated,
                }, { setAuthenticated: !!fileAuth.authenticated })
              }
            }
          }
        } catch {
          // File not available
        }

        // Sync token to operator if we have credentials
        if (this.token && this.user) {
          this.syncTokenToContextService(this.token, this.user).catch((error) => {
            console.warn('Background context sync failed:', error)
          })
        }
      } catch (error) {
        import('@/composables/useLogger').then(({ getLogger }) => getLogger().then(l => l.warn(`Failed to hydrate auth state: ${error}`))).catch(() => {})
        await this.clearPersistedState()
      }
    },

    async clearPersistedState() {
      if (typeof window === 'undefined') return

      // Clean up legacy storage locations
      localStorage.removeItem('cp_auth')
      localStorage.removeItem('cp_auth_token')

      // Remove auth.json — single source of truth
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (isTauriEnv()) {
          const { invoke } = await import('@tauri-apps/api/core')
          const { remove, exists } = await import('@tauri-apps/plugin-fs')
          const baseDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
          const authPath = `${baseDir}/auth.json`
          if (await exists(authPath)) {
            await remove(authPath)
          }
        }
      } catch {
        // File removal is best-effort
      }
    },

    async initialize() {
      await this.hydrateAuthState()

      if (this.token && this.user) {
        await this.checkAuth()

        if (this.isAuthenticated) {
          this.syncTokenToContextService(this.token, this.user).catch((err) =>
            console.warn('Background syncTokenToContextService failed:', err)
          )
        }
      }
    },
  },
})
