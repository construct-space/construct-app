import { appConfig } from '@/utils/config'
import { useAuthStore } from '@/stores/auth'

export const useApi = () => {
  const baseURL = appConfig.apiBase
  const apiKey = appConfig.apiKey
  const authStore = useAuthStore()

  const setToken = (newToken: string) => {
    authStore.token = newToken
  }

  const removeToken = () => {
    authStore.token = null
    // Clean up legacy localStorage key
    localStorage.removeItem('cp_auth_token')
  }

  const getHeaders = (includeAuth = true): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    }

    if (includeAuth && authStore.token) {
      headers.Authorization = `Bearer ${authStore.token}`
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
        if (!options.skipErrorHandling && response.status === 401) {
          if (!isAuthEndpoint(endpoint)) {
            if (import.meta.env.DEV) {
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
    await authStore.logout()
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
    token: computed(() => authStore.token),
    setToken,
    removeToken,

    get: <T = unknown>(endpoint: string, options?: { params?: Record<string, string | number> }) =>
      apiRequest<T>(endpoint, { params: options?.params }),
    post: <T = unknown>(endpoint: string, data?: unknown) => apiRequest<T>(endpoint, { method: 'POST', body: data }),
    put: <T = unknown>(endpoint: string, data?: unknown) => apiRequest<T>(endpoint, { method: 'PUT', body: data }),
    patch: <T = unknown>(endpoint: string, data?: unknown) => apiRequest<T>(endpoint, { method: 'PATCH', body: data }),
    delete: <T = unknown>(endpoint: string) => apiRequest<T>(endpoint, { method: 'DELETE' }),

    authPost: <T = unknown>(endpoint: string, data?: unknown) => authRequest<T>(endpoint, { method: 'POST', body: data }),
    authGet: <T = unknown>(endpoint: string) => authRequest<T>(endpoint),

    authRequest: authRequest,
    request: apiRequest,
  }
}
