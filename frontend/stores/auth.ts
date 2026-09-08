import { defineStore } from 'pinia'
import type { AuthUserData } from '@/types'

interface ConstructOAuthProfile {
  id: string
  email: string
  username: string
  first_name: string
  last_name: string
  avatar_url?: string
}

const userDataFromProfile = (profile: ConstructOAuthProfile): AuthUserData => ({
  id: String(profile.id),
  email: profile.email,
  username: profile.username,
  first_name: profile.first_name,
  last_name: profile.last_name,
  name: `${profile.first_name} ${profile.last_name}`.trim(),
  avatar: profile.avatar_url || undefined,
  created_at: '',
  updated_at: '',
})

interface AuthState {
  user: AuthUserData | null
  token: string | null
  oauthToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  orgId: string | null
  isOrgManaged: boolean
  orgRole: string | null
  orgName: string | null
  orgDeveloperStatus: string | null
  // Scope-aware state populated from accounts /api/me/scope.
  scope: 'user' | 'org' | null
  roles: string[]
  personalDeveloper: boolean
  // True when the active org has a publisher row on developer-api.
  // Distinct from `roles.includes('developer')` — the latter is the
  // per-user role that gates publishing actions; this is whether the
  // org-as-an-identity is enrolled at all. The Settings UI uses this
  // to show "enrolled" to every member of an enrolled org.
  orgDeveloper: boolean
}

const _isContextNotConnectedError = (error: unknown): boolean =>
  String(error).toLowerCase().includes('not connected')

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    token: null,
    oauthToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    orgId: null,
    isOrgManaged: false,
    orgRole: null,
    orgName: null,
    orgDeveloperStatus: null,
    scope: null,
    roles: [],
    personalDeveloper: false,
    orgDeveloper: false,
  }),

  getters: {
    currentUser: (state) => state.user,
    userName: (state) => state.user?.name || 'User',
    userEmail: (state) => state.user?.email || '',
    userAvatar: (state) => state.user?.avatar || null,
    // True when the user has the Developer capability in their current scope.
    // Personal scope → personalDeveloper flag. Org scope → either the org
    // itself is a publisher (orgDeveloper) or the user holds the Developer
    // role explicitly. orgDeveloper is the right signal for "the developer
    // experience is unlocked here" because enrollment is org-level; the
    // role is a separate finer-grained capability gate within the org.
    isDeveloper(state): boolean {
      if (state.scope === 'user') return state.personalDeveloper
      if (state.scope === 'org') return state.orgDeveloper || state.roles.includes('developer')
      // Legacy fallback for state populated via old /api/me flow.
      if (state.isOrgManaged) return state.orgDeveloperStatus === 'enrolled'
      return state.user?.developer_status === 'enrolled'
    },
    // True when the user holds an admin-ish role in their org scope.
    isOrgAdmin(state): boolean {
      if (state.scope !== 'org') return false
      return state.roles.includes('owner') || state.roles.includes('admin')
    },
  },

  actions: {
    // Pulls the scope-aware identity from accounts /api/me/scope and
    // populates scope/roles/personalDeveloper. Safe to call any time we
    // suspect the server-side role/membership state has drifted — e.g.
    // on app startup or after the user dismisses a "restart to refresh"
    // notice. Does nothing if we don't have an OAuth token yet.
    async refreshScope(): Promise<void> {
      const accessToken = this.oauthToken || this.token
      if (!accessToken) return
      const prevScope = this.scope
      const prevOrgId = this.orgId
      try {
        const { useConstructAuth } = await import('@/composables/useConstructAuth')
        const constructAuth = useConstructAuth()
        const result = await constructAuth.fetchScope(accessToken)
        this.scope = result.scope
        this.roles = result.roles || []
        this.personalDeveloper = Boolean(result.developer)
        if (result.scope === 'org' && result.org) {
          this.orgId = result.org.id
          this.orgName = result.org.name
          this.isOrgManaged = true
          this.orgDeveloper = Boolean(result.org.developer)
        } else {
          this.isOrgManaged = false
          this.orgDeveloper = false
        }
        // If scope/org actually changed, the publisher key on disk may
        // belong to the previous identity. Re-sync so CLI + operator +
        // space runtime pick up the right one without waiting for a
        // re-login. syncPublisherCredentials skips work when nothing
        // actually needs to change, so it's safe to call unconditionally.
        if (this.scope !== prevScope || this.orgId !== prevOrgId) {
          const { syncPublisherCredentials } = await import('@/composables/useDevMode')
          await syncPublisherCredentials()
        }
      } catch {
        // Scope refresh is best-effort — a network blip shouldn't log the user out.
      }
    },

    async syncTokenToContextService(_token?: string | null, _user?: AuthUserData | null) {
      // No-op: auth sync to operator was removed (was for construct-dev, no longer needed).
      // Operator manages its own auth via OAuth providers directly.
    },

    // Apply a bearer-token pair that arrived from any path (OAuth exchange or
    // direct /api/auth/login with client_id). Loads profile + org state and
    // persists to auth.json. Returns user data on success. Keeps loginWithOAuth
    // and loginWithPassword identical past the token-acquisition step.
    async applyBearerTokens(accessToken: string, oauthToken: string | null, profile?: ConstructOAuthProfile | null) {
      this.token = accessToken
      this.oauthToken = oauthToken || accessToken

      const { useApi } = await import('@/composables/useApi')
      const api = useApi()
      api.setToken(accessToken)

      let resolvedProfile = profile || null
      if (!resolvedProfile) {
        const { useConstructAuth } = await import('@/composables/useConstructAuth')
        const constructAuth = useConstructAuth()
        resolvedProfile = await constructAuth.fetchProfile(this.oauthToken!)
      }

      const userData = userDataFromProfile(resolvedProfile)
      this.user = userData

      await this.checkOrgMembership()
      // One profile per user regardless of org membership — org state lives
      // in the auth store, not as a separate profile row on disk.
      await this.ensureProfileForUser(userData)

      this.isAuthenticated = true
      await this.persistAuthState()
      // Mirror into the OS keychain when biometric unlock is on. This is the
      // source signInWithBiometric reads on re-entry after a soft logout, so
      // it has to stay fresh on every token rotation (initial login, 2FA
      // completion, refresh). No-op when the flag isn't set for this email.
      if (this.isBiometricUnlockEnabled()) {
        await this.persistTokensToKeychain()
      }
      await this.syncTokenToContextService(accessToken, userData)
      await this.syncProfileFromUser()

      // Resolve scope, then mirror the publisher API key into auth.json so
      // `construct publish` from this machine attributes Spaces to the active
      // org (or user). refreshStatus() refreshes scope first, then syncs the
      // scope-matching publisher key — without this the block only ever
      // landed via the Settings → Developer flow, so a plain login left the
      // CLI unable to publish org-owned spaces. Best-effort: a failure here
      // must not break login.
      try {
        const { useDevMode } = await import('@/composables/useDevMode')
        await useDevMode().refreshStatus()
      } catch { /* best-effort — login still succeeded */ }

      return userData
    },

    // Direct password login — skips the browser + deep-link roundtrip.
    // Returns one of three shapes: { requires_2fa, pending_token } when the
    // user has TOTP enabled (caller must prompt for the code then call
    // completeTwoFactorLogin), { must_change_password, reset_token } when
    // the account is gated on reset, or { success: true, data } on success.
    async loginWithPassword(email: string, password: string) {
      this.isLoading = true
      this.error = null
      try {
        const { useConstructAuth } = await import('@/composables/useConstructAuth')
        const constructAuth = useConstructAuth()
        const result = await constructAuth.loginWithPassword(email, password) as Record<string, unknown>

        if (result.requires_2fa) {
          return { kind: 'needs_2fa' as const, pending_token: result.pending_token as string }
        }
        if (result.must_change_password) {
          return { kind: 'needs_reset' as const, reset_token: result.reset_token as string }
        }
        if (!result.access_token) {
          throw new Error((result.error as string) || 'Login failed')
        }
        const profile = (result.user as ConstructOAuthProfile | undefined) || null
        // Pass null for oauthToken — there's no separate profile-service token
        // in the direct-login flow (that slot only exists for legacy OAuth
        // exchanges). applyBearerTokens defaults oauthToken to accessToken
        // when we pass null, which is what /api/accounts/me expects.
        const data = await this.applyBearerTokens(result.access_token as string, null, profile)
        // Existing-account sign-in → onboarding has nothing new to teach.
        // Mark it complete silently so the guard doesn't bounce returning
        // users through the welcome flow. Register sets a freshly-minted
        // account through the onboarding path; this only covers logins.
        void this._markOnboardingComplete()
        return { kind: 'ok' as const, data }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Login failed'
        this.clearAuthState()
        this.error = msg
        return { kind: 'error' as const, error: msg }
      } finally {
        this.isLoading = false
      }
    },

    // Complete login after the user typed their TOTP code. pendingToken comes
    // from the loginWithPassword { kind: 'needs_2fa' } branch.
    async completeTwoFactorLogin(pendingToken: string, code: string) {
      this.isLoading = true
      this.error = null
      try {
        const { useConstructAuth } = await import('@/composables/useConstructAuth')
        const constructAuth = useConstructAuth()
        const result = await constructAuth.verifyTwoFactor(pendingToken, code) as Record<string, unknown>
        if (!result.access_token) {
          throw new Error((result.error as string) || '2FA verification failed')
        }
        const profile = (result.user as ConstructOAuthProfile | undefined) || null
        const data = await this.applyBearerTokens(result.access_token as string, null, profile)
        void this._markOnboardingComplete()
        return { kind: 'ok' as const, data }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : '2FA verification failed'
        this.error = msg
        return { kind: 'error' as const, error: msg }
      } finally {
        this.isLoading = false
      }
    },

    async registerWithPassword(payload: {
      first_name: string
      last_name: string
      email: string
      username: string
      password: string
      phone?: string
    }) {
      this.isLoading = true
      this.error = null
      try {
        const { useConstructAuth } = await import('@/composables/useConstructAuth')
        const constructAuth = useConstructAuth()
        const result = await constructAuth.registerAccount(payload) as Record<string, unknown>
        if (!result.access_token) {
          throw new Error((result.error as string) || 'Registration failed')
        }
        const profile = (result.user as ConstructOAuthProfile | undefined) || null
        const data = await this.applyBearerTokens(result.access_token as string, null, profile)
        return { kind: 'ok' as const, data }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Registration failed'
        this.clearAuthState()
        this.error = msg
        return { kind: 'error' as const, error: msg }
      } finally {
        this.isLoading = false
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

        const userData = userDataFromProfile(profile)

        // Check org membership BEFORE creating any profile
        // Need token + user email set for the API call
        this.user = userData

        // checkOrgMembership calls refreshScope internally; no need to repeat.
        await this.checkOrgMembership()

        // One profile per user — org membership is stored in the auth store,
        // not as a second profile row.
        await this.ensureProfileForUser(userData)

        this.isAuthenticated = true
        await this.persistAuthState()
        if (this.isBiometricUnlockEnabled()) {
          await this.persistTokensToKeychain()
        }
        await this.syncTokenToContextService(apiToken, userData)
        await this.syncProfileFromUser()

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

    // Sign out. Default is "soft": disconnects the session and forgets the
    // biometric/keychain material, but keeps the profile row, onboarding
    // progress, tasks, and pinned items — signing back in as the same user
    // puts everything back where it was. Pass { wipeLocalData: true } to
    // also delete the profile and all per-user local state (the "cleanup"
    // path in the logout dialog).
    async logout(opts: { wipeLocalData?: boolean } = {}) {
      this.isLoading = true
      const wipe = !!opts.wipeLocalData

      // Bound each awaited cleanup step so a stalled Tauri invoke (macOS
      // keychain prompt, unresponsive operator, hung fetch) can't lock the
      // sign-out dialog open. The modal uses :prevent-close="logoutBusy"
      // and logoutBusy only clears when logout() resolves — without these
      // timeouts the user is stuck staring at "Signing out…" forever.
      const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race<T | undefined>([
            p,
            new Promise<undefined>(resolve => {
              timer = setTimeout(() => {
                console.warn(`[Auth] logout: ${label} exceeded ${ms}ms — abandoning step`)
                resolve(undefined)
              }, ms)
            }),
          ])
        } finally {
          if (timer) clearTimeout(timer)
        }
      }

      const userEmail = this.user?.email
      const userId = this.user?.id || userEmail || 'unknown'
      const activeProfileId = await this._getActiveProfileId()

      // Biometric + keychain only get wiped on the destructive path. Soft
      // sign-out is "log me out, but I want to come right back with Touch
      // ID" — clearing the flag there would make the unlock button
      // disappear on the next /login visit, which defeats the point.
      if (wipe && userEmail) {
        localStorage.removeItem(`construct:biometric_unlock:${userEmail}`)
        await withTimeout(this.clearTokensFromKeychain(userEmail), 3000, 'clearTokensFromKeychain')
      }

      const { useApi } = await import('@/composables/useApi')
      useApi().removeToken()

      // Both paths remove auth.json — it's the CLI-facing mirror of the
      // current session, and the session just ended. Touch ID re-entry
      // doesn't read auth.json any more; it reads identity from
      // profiles.json + tokens from the OS keychain, so soft logout can
      // drop auth.json and still offer "Sign in with Touch ID".
      await withTimeout(this.clearPersistedState(), 3000, 'clearPersistedState')
      this.clearAuthState()

      if (wipe) {
        // Per-user localStorage scrub.
        localStorage.removeItem('cp_tasks')
        localStorage.removeItem('cp_pinned_items')
        try {
          const { clearOnboarding } = await import('@/composables/useOnboarding')
          if (userId) await clearOnboarding(userId)
        } catch { /* store unavailable — best-effort */ }

        try {
          const { usePinnedStore } = await import('@/stores/pinned')
          await usePinnedStore().clearAll()
        } catch { /* store not ready is fine */ }

        // Drop the profile row. The operator's appdir.DeleteProfile refuses
        // to delete the active profile, so we do the cleanup directly via
        // plugin-fs: remove the on-disk profile directory, then drop the
        // entry from profiles.json. If another profile remains we hand off
        // through profileStore.switchProfile so paths re-init, the brain
        // gets notified, and auth hydrates from the surviving profile's
        // auth.json — without this step the picker showed the surviving
        // profile but its session was never loaded, so clicking the card
        // did nothing.
        // Catches so a partial failure doesn't block the sign-out UX.
        if (activeProfileId) {
          try {
            const { isTauriEnv } = await import('@/utils/tauri')
            if (isTauriEnv()) {
              const { invoke } = await import('@tauri-apps/api/core')
              const { remove, readTextFile, writeTextFile, exists } = await import('@tauri-apps/plugin-fs')
              const base = await invoke<string>('get_construct_data_dir')
              const baseTrim = base.replace(/\/$/, '')
              const profileDir = `${baseTrim}/profiles/${activeProfileId}`
              if (await exists(profileDir)) {
                await remove(profileDir, { recursive: true })
              }
              let nextActiveId = ''
              const registryPath = `${baseTrim}/profiles.json`
              if (await exists(registryPath)) {
                const raw = await readTextFile(registryPath)
                const reg = JSON.parse(raw) as {
                  version?: number
                  active_profile?: string
                  profiles?: Array<{ id: string }>
                }
                reg.profiles = (reg.profiles || []).filter(p => p.id !== activeProfileId)
                nextActiveId = reg.profiles[0]?.id || ''
                if (reg.active_profile === activeProfileId) {
                  reg.active_profile = nextActiveId
                }
                await writeTextFile(registryPath, JSON.stringify(reg, null, 2))
              }
              const { useProfileStore } = await import('@/stores/profile')
              const profileStore = useProfileStore()
              profileStore.profiles = (profileStore.profiles || []).filter(p => p.id !== activeProfileId)
              if (nextActiveId) {
                // Drives the Tauri switch_profile command + initAppPaths +
                // brain profile.switch + authStore.clearAuthState +
                // authStore.initialize — that last call rehydrates from the
                // surviving profile's auth.json, so if the user is still
                // signed in there the next /login render lands them in /app.
                // Bounded: brain IPC and the profile-validation fetch
                // inside initialize() have no internal timeout, so a dead
                // operator or hung accounts request would otherwise stall
                // sign-out indefinitely. On timeout the user lands on
                // /login (where the profile switcher can recover).
                await withTimeout(profileStore.switchProfile(nextActiveId), 5000, 'profileStore.switchProfile')
              } else {
                profileStore.activeProfileId = ''
              }
            }
          } catch (e) {
            console.warn('[Auth] profile cleanup failed:', e)
          }
        }
      }

      this.isLoading = false
    },

    async _getActiveProfileId(): Promise<string | null> {
      try {
        const { useProfileStore } = await import('@/stores/profile')
        return useProfileStore().activeProfileId
      } catch {
        return null
      }
    },

    // Silently mark onboarding as done for the currently-signed-in user so
    // the route guard won't redirect to /onboarding. Called from the
    // password-login + biometric-unlock paths, which cover returning users.
    // registerWithPassword intentionally does NOT call this — a freshly-
    // minted account is new to the app and should see the welcome flow.
    async _markOnboardingComplete() {
      const userId = this.user?.id || this.user?.email
      if (!userId) return
      try {
        const { markOnboardingComplete } = await import('@/composables/useOnboarding')
        await markOnboardingComplete(userId)
      } catch { /* store unavailable — fall back silently */ }
    },

    async checkAuth() {
      if (!this.token) {
        // Bootstrap already ran hydrate once (possibly with biometric).
        // A second hydrate here must not prompt Touch ID again — if the
        // first one didn't yield a token, re-prompting just asks the
        // user to authenticate twice for nothing. Read auth.json
        // directly via skipBiometric instead.
        await this.hydrateAuthState({ skipBiometric: true })
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
        const profile = await constructAuth.fetchProfile(profileToken!)
        const changed = this.applyProfileToCurrentUser(profile)
        this.isAuthenticated = true
        if (changed) {
          await this.persistAuthState()
          await this.syncProfileFromUser()
        }
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

    applyProfileToCurrentUser(profile: ConstructOAuthProfile): boolean {
      if (!this.user) return false

      const fresh = userDataFromProfile(profile)
      const nextUser: AuthUserData = {
        ...this.user,
        id: fresh.id,
        email: fresh.email,
        username: fresh.username,
        first_name: fresh.first_name,
        last_name: fresh.last_name,
        name: fresh.name,
        avatar: fresh.avatar,
      }

      const changed =
        this.user.id !== nextUser.id ||
        this.user.email !== nextUser.email ||
        this.user.username !== nextUser.username ||
        this.user.first_name !== nextUser.first_name ||
        this.user.last_name !== nextUser.last_name ||
        this.user.name !== nextUser.name ||
        (this.user.avatar || '') !== (nextUser.avatar || '')

      if (changed) {
        this.user = nextUser
      }

      return changed
    },

    clearAuthState() {
      this.user = null
      this.token = null
      this.orgId = null
      this.isOrgManaged = false
      this.orgRole = null
      this.orgName = null
      this.orgDeveloperStatus = null
      this.orgDeveloper = false
      this.scope = null
      this.roles = []
      this.personalDeveloper = false
      this.oauthToken = null
      this.isAuthenticated = false
      this.error = null
    },

    // ─── Biometric unlock (Touch ID / Windows Hello) ────────────────────
    // Thin wrappers around the Tauri commands in desktop/src/biometric.rs.
    // Web fallbacks return "not available" rather than throwing so callers
    // can render a capability-gated UI without a try/catch everywhere.
    async biometricAvailable(): Promise<boolean> {
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (!isTauriEnv()) return false
        const { invoke } = await import('@tauri-apps/api/core')
        return await invoke<boolean>('biometric_available')
      } catch {
        return false
      }
    },

    async biometricVerify(reason: string): Promise<boolean> {
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (!isTauriEnv()) return false
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('biometric_verify', { reason })
        return true
      } catch {
        return false
      }
    },

    // Persist the current session's tokens into the OS keychain, keyed by
    // the logged-in user's email. Idempotent — safe to call after every
    // applyBearerTokens when biometric unlock is enabled.
    async persistTokensToKeychain(): Promise<void> {
      if (!this.user?.email || !this.token) {
        console.warn('[Auth] persistTokensToKeychain skipped: email=%s token=%s',
          this.user?.email || 'none', !!this.token)
        return
      }
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (!isTauriEnv()) return
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('construct_auth_save_tokens', {
          account: this.user.email,
          accessToken: this.token,
          refreshToken: this.oauthToken && this.oauthToken !== this.token ? this.oauthToken : null,
        })
        console.log('[Auth] persistTokensToKeychain: wrote for', this.user.email)
      } catch (e) {
        console.warn('[Auth] persistTokensToKeychain failed:', e)
      }
    },

    async loadTokensFromKeychain(email: string): Promise<{ access_token: string; refresh_token?: string } | null> {
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (!isTauriEnv()) return null
        const { invoke } = await import('@tauri-apps/api/core')
        return await invoke('construct_auth_load_tokens', { account: email })
      } catch (e) {
        console.warn('[Auth] loadTokensFromKeychain error for %s: %s', email, e)
        return null
      }
    },

    async clearTokensFromKeychain(email: string): Promise<void> {
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (!isTauriEnv()) return
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('construct_auth_clear_tokens', { account: email })
      } catch {
        // best-effort
      }
    },

    // Enable biometric unlock for the current session. Requires the user to
    // pass the prompt once right now, then stores tokens + a flag so future
    // launches can re-prompt. Returns false if biometric isn't available or
    // the user cancelled.
    async enableBiometricUnlock(): Promise<boolean> {
      if (!this.user?.email) {
        console.warn('[Auth] enableBiometricUnlock: no user email')
        return false
      }
      const available = await this.biometricAvailable()
      console.log('[Auth] enableBiometricUnlock: available=%s', available)
      if (!available) return false
      const verified = await this.biometricVerify('Enable biometric unlock for Construct')
      console.log('[Auth] enableBiometricUnlock: verified=%s', verified)
      if (!verified) return false
      await this.persistTokensToKeychain()
      // Confirm the write landed before we set the flag — otherwise the
      // "button shows but keychain empty" inconsistency re-emerges.
      const check = await this.loadTokensFromKeychain(this.user.email)
      if (!check?.access_token) {
        console.warn('[Auth] enableBiometricUnlock: keychain verify failed — flag NOT set')
        return false
      }
      localStorage.setItem(`construct:biometric_unlock:${this.user.email}`, '1')
      console.log('[Auth] enableBiometricUnlock: ok for', this.user.email)
      return true
    },

    async disableBiometricUnlock(): Promise<void> {
      if (!this.user?.email) return
      localStorage.removeItem(`construct:biometric_unlock:${this.user.email}`)
      await this.clearTokensFromKeychain(this.user.email)
    },

    isBiometricUnlockEnabled(): boolean {
      if (!this.user?.email) return false
      return this.isBiometricFlagSetFor(this.user.email)
    },

    isBiometricFlagSetFor(email: string): boolean {
      return localStorage.getItem(`construct:biometric_unlock:${email}`) === '1'
    },

    // Returns the email of the active profile when biometric unlock is
    // enabled AND the keychain actually has tokens for it. Reads identity
    // from profiles.json (via the store); a keychain preflight then guards
    // against stale localStorage flags that survived a session whose
    // keychain was cleared (e.g. an older hard-logout codepath that didn't
    // clear both in lockstep). Self-heals by removing the stale flag so
    // the button won't reappear on the next mount. No prompt.
    async getBiometricCandidate(): Promise<string | null> {
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (!isTauriEnv()) return null
        const { useProfileStore } = await import('@/stores/profile')
        const profileStore = useProfileStore()
        if (!profileStore.initialized) {
          await profileStore.init()
        }
        const email = profileStore.activeProfile?.email
        if (!email) return null
        if (!this.isBiometricFlagSetFor(email)) return null

        const tokens = await this.loadTokensFromKeychain(email)
        if (!tokens?.access_token) {
          console.log('[Auth] biometric flag set but keychain empty for', email, '— clearing stale flag')
          localStorage.removeItem(`construct:biometric_unlock:${email}`)
          return null
        }
        return email
      } catch {
        return null
      }
    },

    // Manual "Sign in with Touch ID". Prompts biometric, then loads tokens
    // from the OS keychain and runs them through applyBearerTokens — same
    // path loginWithPassword uses, so user profile, org scope, and
    // auth.json all get re-hydrated consistently. The keychain is the
    // source of truth after soft logout wipes auth.json.
    async signInWithBiometric(): Promise<boolean> {
      const email = await this.getBiometricCandidate()
      if (!email) return false
      const verified = await this.biometricVerify('Unlock Construct')
      if (!verified) return false
      try {
        const tokens = await this.loadTokensFromKeychain(email)
        if (!tokens?.access_token) {
          console.warn('[Auth] biometric unlock: keychain has no tokens for', email)
          return false
        }
        // oauthToken=null → applyBearerTokens reuses access_token for
        // /api/accounts/me. refresh_token isn't an identity token — sending
        // it as Bearer would 401 at the gateway.
        await this.applyBearerTokens(tokens.access_token, null, null)
        void this._markOnboardingComplete()
        return true
      } catch (e) {
        console.warn('[Auth] biometric unlock failed:', e)
        return false
      }
    },




    async persistAuthState() {
      if (typeof window === 'undefined') return

      // auth.json file in data dir — single source of truth (shared with CLI/operator)
      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (!isTauriEnv()) {
          console.log('[Auth] persistAuthState skipped: not in Tauri')
          return
        }

        const { invoke } = await import('@tauri-apps/api/core')
        const { readTextFile, writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')

        const baseDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
        console.log('[Auth] persistAuthState: baseDir =', JSON.stringify(baseDir))
        if (!baseDir) {
          console.warn('[Auth] persistAuthState: get_data_dir returned empty — no active profile?')
          return
        }
        if (!await exists(baseDir)) {
          await mkdir(baseDir, { recursive: true })
        }

        const authPath = `${baseDir}/auth.json`

        // Read-modify-write: preserve fields this store doesn't own — most
        // importantly the `publisher` block written by the dev-mode publisher
        // sync. A blind overwrite here dropped the org publisher API key on
        // every token rotation (initial login, 2FA, refresh), so the CLI lost
        // org attribution and `construct publish` rejected org-owned spaces
        // after any re-login.
        let existing: Record<string, unknown> = {}
        if (await exists(authPath)) {
          try { existing = JSON.parse(await readTextFile(authPath)) } catch { /* overwrite malformed */ }
        }

        const authFile = {
          ...existing,
          user: this.user,
          token: this.token,
          oauth_token: this.oauthToken,
          authenticated: this.isAuthenticated,
          updated_at: new Date().toISOString(),
        }

        await writeTextFile(authPath, JSON.stringify(authFile, null, 2))
        console.log('[Auth] persistAuthState: wrote', authPath)
      } catch (e) {
        console.warn('[Auth] persistAuthState failed:', e)
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

    async hydrateAuthState(opts: { skipBiometric?: boolean } = {}) {
      if (typeof window === 'undefined') return
      // Skip if user is adding a new account (flag set by profile picker)
      if (sessionStorage.getItem('construct:adding_account')) {
        sessionStorage.removeItem('construct:adding_account')
        return
      }

      // Dedupe concurrent hydrate calls so boot doesn't fire Touch ID
      // twice. Previously `bootstrapMain → authStore.initialize()` and
      // the router guard's first-route auth check raced — both saw
      // `!isAuthenticated` at their respective moments and both
      // prompted. Merging into a single in-flight promise means the
      // router guard's call awaits the bootstrap call's result
      // instead of kicking a second biometric prompt.
      //
      // A concurrent call that asked to *skip* biometric must not be
      // satisfied by an in-flight call that's going to prompt for it:
      // that would defeat the skip. We only share the promise when
      // both callers agree (either both skipping or both not).
      const flight = (this as unknown as { _hydrateInflight?: { promise: Promise<void>; skipBiometric: boolean } })._hydrateInflight
      if (flight && !!flight.skipBiometric === !!opts.skipBiometric) {
        return flight.promise
      }

      const promise = this._doHydrate(opts)
      ;(this as unknown as { _hydrateInflight?: { promise: Promise<void>; skipBiometric: boolean } })._hydrateInflight = {
        promise,
        skipBiometric: !!opts.skipBiometric,
      }
      try {
        await promise
      } finally {
        ;(this as unknown as { _hydrateInflight?: unknown })._hydrateInflight = undefined
      }
    },

    async _doHydrate(_opts: { skipBiometric?: boolean } = {}) {
      if (typeof window === 'undefined') return

      try {
        // Single-path boot:
        //   - auth.json on disk → restore session, done.
        //   - auth.json missing → leave auth state empty so the route
        //     guard redirects to /login, where the user can tap
        //     "Sign in with Touch ID" (LoginPage renders that button
        //     via `authStore.getBiometricCandidate()`) or enter a
        //     password. Prompting Touch ID from bootstrap made every
        //     fresh session + every popout surface a system modal
        //     before the login form had even rendered — jarring, and
        //     indistinguishable from an authentication failure when
        //     the user just wanted to log in the normal way.
        //
        // `skipBiometric` is now a no-op for the happy path (we
        // always skip) but preserved on the signature so every
        // caller's existing option stays valid without a sweep.
        try {
          const { isTauriEnv } = await import('@/utils/tauri')
          if (isTauriEnv()) {
            const { invoke } = await import('@tauri-apps/api/core')
            const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
            const baseDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
            if (!baseDir) return
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
        console.warn(`Failed to hydrate auth state: ${error}`)
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

    async initialize(opts: { skipBiometric?: boolean } = {}) {
      // Secondary windows (detach popouts, runner, preview) pass
      // skipBiometric so they inherit the main window's already-
      // unlocked session via auth.json on disk instead of prompting
      // Touch ID per window open. The main window still prompts
      // normally on its own boot.
      await this.hydrateAuthState(opts)

      if (this.token && this.user) {
        await this.checkAuth()

        if (this.isAuthenticated) {
          this.syncTokenToContextService(this.token, this.user).catch((err) =>
            console.warn('Background syncTokenToContextService failed:', err)
          )

          // Update profile name/email from authenticated user
          this.syncProfileFromUser()

          // Check org membership — may switch to org profile
          this.checkOrgMembership().catch((err) =>
            console.warn('Background org membership check failed:', err)
          )
        }
      }
    },

    /** Ensure a profile exists for this user (create or migrate). */
    async ensureProfileForUser(userData: AuthUserData) {
      try {
        const { useProfileStore } = await import('@/stores/profile')
        const profileStore = useProfileStore()
        if (!profileStore.initialized) {
          await profileStore.init()
        }

        const accountsUUID = userData.id
        if (!accountsUUID) return

        // Already have a profile with this UUID — just switch to it
        const existing = profileStore.profiles.find(p => p.id === accountsUUID)
        if (existing) {
          if (profileStore.activeProfileId !== accountsUUID) {
            await profileStore.switchProfile(accountsUUID)
          }
          return
        }

        // Same person, different local profile row. Happens when a profile
        // was seeded with a random UUID (pre-accounts cutover) or when the
        // user signed in via a path that created a duplicate. Rename the
        // existing one to the accounts UUID instead of piling up a second
        // row with the same email. Legacy `org:<uuid>` profiles are also
        // rolled into the main row — we no longer create them.
        if (userData.email) {
          const sameEmail = profileStore.profiles.find(p =>
            !!p.email &&
            p.email.toLowerCase() === userData.email!.toLowerCase()
          )
          if (sameEmail) {
            const renamed = await profileStore.renameProfile(sameEmail.id, accountsUUID)
            if (renamed) {
              if (profileStore.activeProfileId !== accountsUUID) {
                await profileStore.switchProfile(accountsUUID)
              }
              return
            }
          }
        }

        // Legacy migration: a pre-accounts "Default" profile with no email.
        // Promote it to the accounts UUID rather than piling a second profile
        // next to it.
        if (profileStore.profiles.length === 1 && profileStore.activeProfileId) {
          const onlyProfile = profileStore.profiles[0]
          if (!onlyProfile.email) {
            const migrated = await profileStore.renameProfile(onlyProfile.id, accountsUUID)
            if (migrated) return
          }
        }

        // Create a new profile for this account
        const name = userData.name || userData.email || 'User'
        await profileStore.createProfile(accountsUUID, name, userData.email, userData.avatar)
      } catch (e) {
        console.warn('[Auth] ensureProfileForUser failed:', e)
      }
    },

    /** Check if user belongs to an org and set org state + switch to org profile. */
    async checkOrgMembership() {
      if (!this.token) return

      try {
        // Ask /api/me/scope first. If the user isn't in an org, skip the
        // /api/org probe entirely — that request would 404 and spam the
        // console with a cross-origin error for users who have no org.
        await this.refreshScope()
        if (this.scope !== 'org') {
          this.orgId = null
          this.isOrgManaged = false
          this.orgRole = null
          this.orgName = null
          this.orgDeveloperStatus = null
          return
        }

        const { useOrgStore } = await import('@/stores/org')
        const orgStore = useOrgStore()

        if (!orgStore.hydrated) {
          await orgStore.fetchAll()
        }

        if (!orgStore.isEnabled) {
          this.orgId = null
          this.isOrgManaged = false
          this.orgRole = null
          this.orgName = null
          this.orgDeveloperStatus = null
          return
        }

        // Org is enabled — populate the org state. We intentionally DON'T
        // create a second `org:<uuid>` profile row any more: one profile
        // per user, keyed by their accounts UUID. The org context lives in
        // the auth store (orgId/orgName/roles/scope) so the UI can render
        // the "Managed" badge and scope behaviour without a second row on
        // disk. Same email → same profile, regardless of membership.
        this.orgId = orgStore.orgId
        this.isOrgManaged = true
        this.orgName = orgStore.orgName

        const authUser = this.user
        const member = orgStore.members.find(m => m.user_id === authUser?.id)
        this.orgRole = member?.role ?? null
        this.orgDeveloperStatus = orgStore.currentOrg?.developer_status ?? null
      } catch (e) {
        console.warn('[Auth] checkOrgMembership failed:', e)
      }
    },

    /** Update the active profile's name and email from the logged-in user. */
    async syncProfileFromUser() {
      if (!this.user) return
      try {
        const { useProfileStore } = await import('@/stores/profile')
        const profileStore = useProfileStore()
        if (!profileStore.initialized) {
          await profileStore.init()
        }
        if (!profileStore.activeProfileId) return

        const name = this.user.name || this.user.username || this.user.email || ''
        const email = this.user.email || ''
        const avatar = this.user.avatar || ''
        const profileId = profileStore.activeProfileId

        const localProfile = profileStore.profiles.find(profile => profile.id === profileId)
        const shouldUpdate = !!(name || email || avatar) && (
          !localProfile
          || localProfile.name !== name
          || (localProfile.email || '') !== email
          || (localProfile.avatar || '') !== avatar
        )
        if (!shouldUpdate) return

        try {
          const { isTauriEnv } = await import('@/utils/tauri')
          if (isTauriEnv()) {
            const { invoke } = await import('@tauri-apps/api/core')
            await invoke('update_profile', {
              profileId,
              name,
              email,
              avatar,
            })
          }
        } catch { /* desktop command is best-effort */ }

        if (localProfile) {
          localProfile.name = name
          localProfile.email = email
          localProfile.avatar = avatar || undefined
        }

        try {
          const { useBrain } = await import('@/brain')
          const brain = useBrain()
          await brain.request('profile.update', {
            id: profileId,
            name,
            email,
            avatar,
          })
        } catch { /* operator may not be connected yet */ }
      } catch { /* profile store not available */ }
    },
  },
})
