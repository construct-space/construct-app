import { appConfig } from '@/utils/config'
import { isTauriEnv } from '@/utils/tauri'
import { APP_DEEP_LINK_SCHEME } from '@/lib/appPaths'
import { info, warn as logWarn, error as logError } from '@tauri-apps/plugin-log'
import { isNetworkError, useNetworkStatus } from '@/composables/useNetworkStatus'

const OAUTH_STATE_KEY = 'construct_oauth_state'
const OAUTH_VERIFIER_KEY = 'construct_oauth_verifier'

// Wall-clock cap for a single profile fetch (Tauri invoke + fetch fallback
// share this budget). Keeps a hung accounts service from stalling callers.
const PROFILE_FETCH_TIMEOUT_MS = 8000

interface ConstructOAuthTokenResponse {
  access_token: string
  oauth_token?: string
  refresh_token?: string
  expires_in?: number | string
  token_type?: string
  error?: string
  error_description?: string
}

interface ConstructOAuthProfile {
  id: string
  email: string
  username: string
  first_name: string
  last_name: string
  avatar_url?: string
}

function generateState(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function extractCodeFromInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const normalize = (value: string): string =>
    value
      .trim()
      .replace(/^[\s"'`<({[]+/, '')
      .replace(/[\s"'`>)\]}]+$/, '')
      .trim()

  const parseCode = (value: string): string | undefined => {
    const cleaned = normalize(value).replace(/^[?#]/, '')
    if (!cleaned) return
    const params = new URLSearchParams(cleaned)
    const direct = params.get('code') || params.get('authorization_code')
    if (!direct) return
    try {
      return decodeURIComponent(direct)
    } catch {
      return direct
    }
  }

  const fromSearchString = (value: string): string | undefined => {
    const byUrl = parseCode(value)
    if (byUrl) return byUrl
    const directMatch = value.match(/(?:^|[?&#])code=([^&\s#]+)/)
    if (directMatch?.[1]) {
      try {
        return decodeURIComponent(directMatch[1])
      } catch {
        return directMatch[1]
      }
    }
    return
  }

  const candidates = new Set<string>([trimmed])
  if (trimmed.includes('?')) candidates.add(trimmed.split('?')[1])
  if (trimmed.includes('#')) candidates.add(trimmed.split('#')[1])

  for (const candidate of candidates) {
    if (!candidate) continue

    try {
      const parsed = new URL(candidate)
      const fromQuery = parseCode(parsed.search)
      if (fromQuery) return fromQuery
      const fromHash = parseCode(parsed.hash)
      if (fromHash) return fromHash
    } catch {
      // Not a URL; continue with heuristics.
    }

    const fromParams = fromSearchString(candidate)
    if (fromParams) return fromParams
  }

  return normalize(trimmed)
}

function getRedirectUri(): string {
  if (isTauriEnv()) {
    return `${APP_DEEP_LINK_SCHEME}://oauth/callback`
  }
  return `${window.location.origin}/oauth/callback`
}

/** Close the OAuth login window if it exists */
function closeOAuthWindow() {
  if (!isTauriEnv()) return
  import('@tauri-apps/api/webviewWindow').then(async ({ WebviewWindow }) => {
    const win = await WebviewWindow.getByLabel('oauth-login')
    if (win) win.close()
  }).catch(() => {})
}

export function useConstructAuth() {
  const accountsUrl = appConfig.accountsUrl
  const clientId = appConfig.oauthClientId

  async function startLogin() {
    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    sessionStorage.setItem(OAUTH_STATE_KEY, state)
    sessionStorage.setItem(OAUTH_VERIFIER_KEY, codeVerifier)

    const redirectUri = getRedirectUri()
    info(`[OAuth] startLogin — redirect_uri: ${redirectUri}, client_id: ${clientId}, state: ${state.slice(0, 8)}...`)

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    const authorizeUrl = `${accountsUrl}/api/oauth/authorize?${params.toString()}`

    if (isTauriEnv()) {
      // Open in the system browser — deep-link brings the user back into
      // the app after OAuth. plugin-opener has a permissive URL scope;
      // plugin-shell's default open() regex rejects multi-dot hosts like
      // my.construct.space. Falls back to window.open for non-Tauri.
      import('@tauri-apps/plugin-opener').then(({ openUrl }) => {
        openUrl(authorizeUrl)
      }).catch(() => {
        window.open(authorizeUrl, '_blank')
      })
    } else {
      window.location.href = authorizeUrl
    }
  }

  async function startPasskeyLogin() {
    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    sessionStorage.setItem(OAUTH_STATE_KEY, state)
    sessionStorage.setItem(OAUTH_VERIFIER_KEY, codeVerifier)

    const redirectUri = getRedirectUri()
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      login_hint: 'passkey',
    })

    const authorizeUrl = `${accountsUrl}/api/oauth/authorize?${params.toString()}`

    if (isTauriEnv()) {
      import('@tauri-apps/plugin-opener').then(({ openUrl }) => {
        openUrl(authorizeUrl)
      }).catch(() => {
        window.open(authorizeUrl, '_blank')
      })
    } else {
      window.location.href = authorizeUrl
    }
  }

  function getRegisterUrl(): string {
    // TODO(my-portal): my.construct.space/register SPA page doesn't exist
    // yet — until it does, these links will 404 once accounts' public face
    // is removed. Track in PRD §17 followups.
    return `${accountsUrl}/register`
  }

  function getForgotPasswordUrl(): string {
    return `${accountsUrl}/forgot-password`
  }

  function validateState(state: string): boolean {
    const stored = sessionStorage.getItem(OAUTH_STATE_KEY)
    // Clean up stored state regardless
    sessionStorage.removeItem(OAUTH_STATE_KEY)

    if (stored === state) return true

    return false
  }

  async function exchangeCode(code: string): Promise<{ access_token: string; oauth_token?: string }> {
    const redirectUri = getRedirectUri()
    const codeVerifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY) || ''
    const normalizedCode = extractCodeFromInput(code)

    info(`[OAuth] exchangeCode — redirect_uri: ${redirectUri}, verifier present: ${!!codeVerifier}, length: ${codeVerifier.length}, client_id: ${clientId}`)
    console.log('[OAuth] exchangeCode — redirect_uri:', redirectUri, 'verifier:', !!codeVerifier, 'length:', codeVerifier.length)

    if (!normalizedCode) {
      throw new Error('No authorization code found')
    }
    if (!codeVerifier) {
      throw new Error('Missing login context. Please retry "Sign in with Construct".')
    }

    const normalizedCodeValue = normalizedCode.length === 128 && normalizedCode.slice(0, 64) === normalizedCode.slice(64)
      ? normalizedCode.slice(0, 64)
      : normalizedCode

    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code: normalizedCodeValue,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }

    const { appConfig: cfg } = await import('@/utils/config')
    let result: ConstructOAuthTokenResponse | null = null
    let tauriError: string | null = null

    if (isTauriEnv()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        result = await invoke<ConstructOAuthTokenResponse>('construct_auth_exchange_code', {
          apiBase: cfg.accountsUrl,
          apiKey: cfg.apiKey,
          body,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        tauriError = message
        logError(`[OAuth] Tauri token exchange fallback failed: ${message}`)
      }
    }

    if (!result) {
      const proxyUrl = `${cfg.accountsUrl}/api/oauth/token`
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errText = await response.text()
        logError(`[OAuth] Token exchange failed: ${response.status} ${errText}`)
        console.error('[OAuth] Token exchange failed:', response.status, errText)
        let parsed: Record<string, string> = {}
        try { parsed = JSON.parse(errText) } catch { /* not JSON */ }
        throw new Error(parsed.error_description || parsed.error || `Token exchange failed (${response.status})`)
      }

      result = await response.json()
    }

    if (tauriError && !result?.access_token) {
      logError(`[OAuth] Falling back to fetch after Tauri error: ${tauriError}`)
    }
    if (!result?.access_token) {
      throw new Error(result?.error || result?.error_description || 'Construct OAuth response did not include an access token')
    }

    // Only clear verifier after successful exchange
    sessionStorage.removeItem(OAUTH_VERIFIER_KEY)

    info('[OAuth] Token exchange successful')
    return {
      access_token: result.access_token,
      oauth_token: result.oauth_token,
    }
  }

  // ─── Direct-login API (no browser round-trip) ──────────────────────────
  // Accounts' password/register/2FA handlers switch from session-cookie to
  // bearer-token responses when we pass `client_id`. Same response shape as
  // /oauth/token so downstream code stays identical to the OAuth flow.
  interface DirectLoginSuccess {
    access_token: string
    refresh_token?: string
    token_type?: string
    expires_in?: number
    scope?: string
    user?: ConstructOAuthProfile
  }
  interface DirectLoginNeeds2FA {
    requires_2fa: true
    pending_token: string
  }
  interface DirectLoginMustReset {
    must_change_password: true
    reset_token: string
  }
  type DirectLoginResponse = DirectLoginSuccess | DirectLoginNeeds2FA | DirectLoginMustReset | { error: string }

  async function postJSON<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${accountsUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let parsed: unknown = {}
    try { parsed = text ? JSON.parse(text) : {} } catch { /* server spoke html; keep empty */ }
    if (!response.ok) {
      const msg = (parsed as { error?: string })?.error || `Request failed (${response.status})`
      throw new Error(msg)
    }
    return parsed as T
  }

  async function loginWithPassword(email: string, password: string): Promise<DirectLoginResponse> {
    return postJSON<DirectLoginResponse>('/api/auth/login', { email, password, client_id: clientId })
  }

  async function verifyTwoFactor(pendingToken: string, code: string): Promise<DirectLoginResponse> {
    return postJSON<DirectLoginResponse>('/api/auth/verify-2fa', { pending_token: pendingToken, code, client_id: clientId })
  }

  async function registerAccount(payload: {
    first_name: string
    last_name: string
    email: string
    username: string
    password: string
    phone?: string
  }): Promise<DirectLoginResponse> {
    return postJSON<DirectLoginResponse>('/api/auth/register', { ...payload, client_id: clientId })
  }

  async function forgotPassword(email: string): Promise<{ message: string }> {
    return postJSON<{ message: string }>('/api/auth/forgot-password', { email })
  }

  async function resetPassword(token: string, password: string, confirm: string): Promise<{ message: string }> {
    return postJSON<{ message: string }>('/api/auth/reset-password', { token, password, confirm_password: confirm })
  }

  async function fetchProfile(accessToken: string): Promise<ConstructOAuthProfile> {
    if (!accessToken) {
      throw new Error('Missing Construct access token')
    }

    const { appConfig: cfg } = await import('@/utils/config')
    let result: ConstructOAuthProfile | null = null
    const network = useNetworkStatus()

    // Shared wall-clock budget across both transports. A server that accepts
    // the connection but never replies would otherwise hang this call (and
    // every caller — checkAuth, the sign-out → switchProfile → initialize
    // chain) indefinitely. The Tauri invoke isn't JS-cancellable so it's
    // raced against a timer; the fetch fallback uses an AbortController.
    const deadline = Date.now() + PROFILE_FETCH_TIMEOUT_MS

    if (isTauriEnv()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        result = await Promise.race([
          invoke<ConstructOAuthProfile>('construct_auth_profile', {
            apiBase: cfg.accountsUrl,
            apiKey: cfg.apiKey,
            accessToken,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              // "error sending request" is what isNetworkError() keys on for
              // reqwest-style failures, so a timeout is treated as transport
              // loss (warn + fall through) rather than an auth misconfig.
              () => reject(new Error('error sending request: profile fetch timed out')),
              Math.max(0, deadline - Date.now()),
            ),
          ),
        ])
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Downgrade network-transport failures to WARN and surface them
        // through the toast channel. A laptop closing its lid shouldn't
        // look the same as an auth misconfiguration in the logs.
        if (isNetworkError(err)) {
          logWarn(`[OAuth] Tauri profile fetch offline: ${msg}`)
          network.reportNetworkError(err, 'profile')
          // Fall through — fetch() below will also fail, but we only
          // log once here.
        } else {
          logError(`[OAuth] Tauri profile fetch failed: ${msg}`)
        }
      }
    }

    if (!result) {
      const proxyUrl = `${cfg.accountsUrl}/api/accounts/me`
      let response: Response
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()))
      try {
        response = await fetch(proxyUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          signal: controller.signal,
        })
      } catch (err) {
        // fetch() throws (doesn't resolve) when the network layer
        // refuses — CORS is the other case but we control both ends.
        // An AbortError here means our deadline fired: treat it as
        // transport loss, same as a refused connection.
        const aborted = err instanceof DOMException && err.name === 'AbortError'
        if (aborted || isNetworkError(err)) {
          network.reportNetworkError(err, 'profile')
          throw new Error('Network unavailable', { cause: err })
        }
        throw err
      } finally {
        clearTimeout(timer)
      }

      if (!response.ok) {
        const errText = await response.text()
        logError(`[OAuth] fetchProfile failed: ${response.status} ${errText}`)
        throw new Error(`Failed to fetch user profile (${response.status})`)
      }

      result = await response.json()
    }

    return result!
  }

  // Fetches the scope-enriched /api/me response in a single call. Returns
  // the user plus scope context (org + roles, or developer flag). Prefer
  // this over fetchProfile when you also need scope info — it replaces the
  // fetchProfile + checkOrgMembership round-trip with one request.
  async function fetchScope(accessToken: string): Promise<{
    user: Record<string, unknown>
    scope: 'user' | 'org'
    org: { id: string; name: string; slug: string; icon: string; developer?: boolean } | null
    roles?: string[]
    member_id?: string
    developer?: boolean
  }> {
    const url = `${accountsUrl}/api/accounts/me/scope`
    const network = useNetworkStatus()
    let response: Response
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch (err) {
      if (isNetworkError(err)) {
        network.reportNetworkError(err, 'scope')
        throw new Error('Network unavailable', { cause: err })
      }
      throw err
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      logError(`[OAuth] fetchScope failed: ${response.status} ${errText}`)
      throw new Error(`Failed to fetch scope (${response.status})`)
    }
    return response.json()
  }

  async function updateProfile(accessToken: string, data: {
    first_name?: string
    last_name?: string
    username?: string
    phone?: string
  }): Promise<Record<string, unknown>> {
    const response = await fetch(`${accountsUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.message || 'Failed to update profile')
    }

    return response.json()
  }

  return {
    startLogin,
    startPasskeyLogin,
    getRegisterUrl,
    getForgotPasswordUrl,
    validateState,
    exchangeCode,
    fetchProfile,
    fetchScope,
    updateProfile,
    closeOAuthWindow,
    accountsUrl,
    loginWithPassword,
    verifyTwoFactor,
    registerAccount,
    forgotPassword,
    resetPassword,
  }
}
