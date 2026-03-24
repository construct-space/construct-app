import { appConfig } from '@/utils/config'

/**
 * Lightweight API client for source.construct.space.
 * Handles providers, preferences, and settings — the cloud sync layer.
 * Auth via Construct accounts Bearer token (same as useApi).
 */
export const useSource = () => {
  const baseURL = appConfig.sourceUrl

  const getToken = (): string | null => {
    try {
      // Dynamic import not possible here (sync), read from auth.json-backed store via localStorage fallback
      // The auth store sets this on login; useApi is the primary API client
      const stored = localStorage.getItem('cp_auth')
      if (stored) {
        const parsed = JSON.parse(stored)
        return parsed.token || null
      }
    } catch { /* ignore */ }
    return null
  }

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = getToken()
    if (token) h.Authorization = `Bearer ${token}`
    return h
  }

  const request = async <T = unknown>(
    endpoint: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> => {
    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers: headers(),
    }
    if (options.body && options.method && options.method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body)
    }

    const resp = await fetch(`${baseURL}${endpoint}`, fetchOptions)
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error(err?.error || `Source API error (${resp.status})`)
    }
    const text = await resp.text()
    if (!text) return {} as T
    return JSON.parse(text) as T
  }

  return {
    get: <T = unknown>(endpoint: string) => request<T>(endpoint),
    put: <T = unknown>(endpoint: string, data?: unknown) => request<T>(endpoint, { method: 'PUT', body: data }),
    delete: <T = unknown>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
  }
}
