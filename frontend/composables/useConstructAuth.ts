import { appConfig } from '@/utils/config'
import { isTauriEnv } from '@/utils/tauri'
import { APP_DEEP_LINK_SCHEME } from '@/lib/appPaths'
import { info, error as logError } from '@tauri-apps/plugin-log'

const OAUTH_STATE_KEY = 'construct_oauth_state'
const OAUTH_VERIFIER_KEY = 'construct_oauth_verifier'
const OAUTH_STATE_KEY_PERSIST = 'construct_oauth_state_persist'
const OAUTH_VERIFIER_KEY_PERSIST = 'construct_oauth_verifier_persist'

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
      .replace(/^[\s"'`<({\[]+/, '')
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
    localStorage.setItem(OAUTH_STATE_KEY_PERSIST, state)
    localStorage.setItem(OAUTH_VERIFIER_KEY_PERSIST, codeVerifier)

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

    const authorizeUrl = `${accountsUrl}/oauth/authorize?${params.toString()}`

    if (isTauriEnv()) {
      // Open in system browser — deep link brings the user back into the app
      import('@tauri-apps/plugin-shell').then(({ open }) => {
        open(authorizeUrl)
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
    localStorage.setItem(OAUTH_STATE_KEY_PERSIST, state)
    localStorage.setItem(OAUTH_VERIFIER_KEY_PERSIST, codeVerifier)

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

    const authorizeUrl = `${accountsUrl}/oauth/authorize?${params.toString()}`

    if (isTauriEnv()) {
      import('@tauri-apps/plugin-shell').then(({ open }) => {
        open(authorizeUrl)
      }).catch(() => {
        window.open(authorizeUrl, '_blank')
      })
    } else {
      window.location.href = authorizeUrl
    }
  }

  function getRegisterUrl(): string {
    return `${accountsUrl}/register`
  }

  function getForgotPasswordUrl(): string {
    return `${accountsUrl}/forgot-password`
  }

  function validateState(state: string): boolean {
    const stored = sessionStorage.getItem(OAUTH_STATE_KEY) || localStorage.getItem(OAUTH_STATE_KEY_PERSIST)
    if (stored === state) {
      sessionStorage.removeItem(OAUTH_STATE_KEY)
      localStorage.removeItem(OAUTH_STATE_KEY_PERSIST)
      return true
    }
    return false
  }

  async function exchangeCode(code: string): Promise<{ access_token: string; oauth_token?: string }> {
    const redirectUri = getRedirectUri()
    const codeVerifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY)
      || localStorage.getItem(OAUTH_VERIFIER_KEY_PERSIST)
      || ''
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
          apiBase: cfg.apiBase,
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
      const proxyUrl = `${cfg.apiBase}/oauth/construct/token`
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': cfg.apiKey,
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
    localStorage.removeItem(OAUTH_VERIFIER_KEY_PERSIST)

    info('[OAuth] Token exchange successful')
    return {
      access_token: result.access_token,
      oauth_token: result.oauth_token,
    }
  }

  async function fetchProfile(accessToken: string): Promise<ConstructOAuthProfile> {
    if (!accessToken) {
      throw new Error('Missing Construct access token')
    }

    const { appConfig: cfg } = await import('@/utils/config')
    let result: ConstructOAuthProfile | null = null

    if (isTauriEnv()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        result = await invoke<ConstructOAuthProfile>('construct_auth_profile', {
          apiBase: cfg.apiBase,
          apiKey: cfg.apiKey,
          accessToken,
        })
      } catch (error) {
        logError(`[OAuth] Tauri profile fetch failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (!result) {
      const proxyUrl = `${cfg.apiBase}/oauth/construct/profile`
      const response = await fetch(proxyUrl, {
        headers: {
          'X-Api-Key': cfg.apiKey,
          'X-Construct-Token': accessToken,
        },
      })

      if (!response.ok) {
        const errText = await response.text()
        logError(`[OAuth] fetchProfile failed: ${response.status} ${errText}`)
        throw new Error(`Failed to fetch user profile (${response.status})`)
      }

      result = await response.json()
    }

    return result!
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
    updateProfile,
    closeOAuthWindow,
    accountsUrl,
  }
}
