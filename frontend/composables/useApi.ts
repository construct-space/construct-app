import { appConfig } from '@/utils/config'

// Helper for localStorage-based token storage (for Tauri)
function useLocalStorageToken() {
  const TOKEN_KEY = 'cp_auth_token'

  return computed({
    get: () => {
      return localStorage.getItem(TOKEN_KEY)
    },
    set: (newValue: string | null) => {
      if (newValue) {
        localStorage.setItem(TOKEN_KEY, newValue)
      } else {
        localStorage.removeItem(TOKEN_KEY)
      }
    }
  })
}

// Helper for cookie-based token storage (web)
function useCookieToken() {
  const TOKEN_KEY = 'cp_auth_token'

  function getCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'))
    return match ? decodeURIComponent(match[1]) : null
  }

  function setCookie(name: string, value: string) {
    document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${60 * 60 * 24 * 30};SameSite=Strict;Secure`
  }

  function deleteCookie(name: string) {
    document.cookie = `${name}=;path=/;max-age=0`
  }

  return computed({
    get: () => getCookie(TOKEN_KEY),
    set: (newValue: string | null) => {
      if (newValue) {
        setCookie(TOKEN_KEY, newValue)
      } else {
        deleteCookie(TOKEN_KEY)
      }
    }
  })
}

export const useApi = () => {
  const baseURL = appConfig.apiBase
  const apiKey = appConfig.apiKey

  // Detect if running in Tauri (tauri:// protocol or __TAURI__ global)
  const isDesktopApp = (
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost' ||
    '__TAURI__' in window ||
    '__TAURI_INTERNALS__' in window
  )

  // For Tauri: use localStorage since cookies don't work reliably with custom protocols
  // For web: use cookies for better security
  const token = isDesktopApp
    ? useLocalStorageToken()
    : useCookieToken()

  const setToken = (newToken: string) => {
    token.value = newToken
  }

  const removeToken = () => {
    token.value = null
  }

  const getHeaders = (includeAuth = true): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    }

    if (includeAuth && token.value) {
      headers.Authorization = `Bearer ${token.value}`
    }

    return headers
  }

  const getAuthOnlyHeaders = (): Record<string, string> => {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    }
  }

  const apiRequest = async <T = unknown>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      body?: unknown
      params?: Record<string, string | number>
      headers?: Record<string, string>
      requireAuth?: boolean
      skipErrorHandling?: boolean
    } = {}
  ): Promise<T> => {
    const requireAuth = options.requireAuth ?? true
    let fullUrl = `${baseURL}${endpoint}`
    const headers = {
      ...getHeaders(requireAuth),
      ...options.headers,
    }

    // Append query params
    if (options.params && Object.keys(options.params).length > 0) {
      const searchParams = new URLSearchParams()
      for (const [key, value] of Object.entries(options.params)) {
        searchParams.append(key, String(value))
      }
      fullUrl += `?${searchParams.toString()}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      const fetchOptions: RequestInit = {
        method: options.method || 'GET',
        headers,
        signal: controller.signal,
      }

      if (options.body && options.method && options.method !== 'GET') {
        fetchOptions.body = JSON.stringify(options.body)
      }

      const response = await fetch(fullUrl, fetchOptions)
      clearTimeout(timeoutId)

      if (!response.ok) {
        // Check for token expiration first (only for protected endpoints)
        if (!options.skipErrorHandling && response.status === 401) {
          if (!isAuthEndpoint(endpoint)) {
            if (import.meta.env.DEV) {
              // In dev mode the local API may not be running — return empty
              return {} as T
            }
            await handleTokenExpired()
            throw new Error('Session expired. Please login again.')
          }
        }

        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData?.message || `API request failed (${response.status})`
        throw new Error(errorMessage)
      }

      // Handle empty responses (204, etc.)
      const text = await response.text()
      if (!text) return {} as T
      return JSON.parse(text) as T
    } catch (error: unknown) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out', { cause: error })
      }

      throw error
    }
  }

  const isAuthEndpoint = (endpoint: string): boolean => {
    const authEndpoints = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password']
    return authEndpoints.some(path => endpoint.includes(path))
  }

  const handleTokenExpired = async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    await authStore.logout()

    // Redirect to login instead of showing errors
    const router = await import('@/router').then(m => m.router)
    if (router.currentRoute.value.path !== '/login') {
      router.push('/login')
    }
  }

  const authRequest = async <T = unknown>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      body?: unknown
      headers?: Record<string, string>
      skipErrorHandling?: boolean
    } = {}
  ): Promise<T> => {
    const fullUrl = `${baseURL}${endpoint}`
    const headers = {
      ...getAuthOnlyHeaders(),
      ...options.headers,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      const fetchOptions: RequestInit = {
        method: options.method || 'GET',
        headers,
        signal: controller.signal,
      }

      if (options.body && options.method && options.method !== 'GET') {
        fetchOptions.body = JSON.stringify(options.body)
      }

      const response = await fetch(fullUrl, fetchOptions)
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData?.message || `API request failed (${response.status})`
        throw new Error(errorMessage)
      }

      const text = await response.text()
      if (!text) return {} as T
      return JSON.parse(text) as T
    } catch (error: unknown) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out', { cause: error })
      }

      throw error
    }
  }

  return {
    // Core functions
    token: readonly(token),
    setToken,
    removeToken,

    // HTTP Methods
    get: <T = unknown>(endpoint: string, options?: { params?: Record<string, string | number> }) =>
      apiRequest<T>(endpoint, { params: options?.params }),
    post: <T = unknown>(endpoint: string, data?: unknown) => apiRequest<T>(endpoint, { method: 'POST', body: data }),
    put: <T = unknown>(endpoint: string, data?: unknown) => apiRequest<T>(endpoint, { method: 'PUT', body: data }),
    patch: <T = unknown>(endpoint: string, data?: unknown) => apiRequest<T>(endpoint, { method: 'PATCH', body: data }),
    delete: <T = unknown>(endpoint: string) => apiRequest<T>(endpoint, { method: 'DELETE' }),

    // Auth-only requests (no Bearer token)
    authPost: <T = unknown>(endpoint: string, data?: unknown) => authRequest<T>(endpoint, { method: 'POST', body: data }),
    authGet: <T = unknown>(endpoint: string) => authRequest<T>(endpoint),

    // Direct access to request methods (for advanced usage)
    authRequest: authRequest,
    request: apiRequest,
  }
}
