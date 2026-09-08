import { appConfig } from '@/utils/config'
import { useAuthStore } from '@/stores/auth'

/**
 * Lightweight API client for the Construct accounts service.
 * Handles user identity, user-scoped preferences, and scope lookups —
 * everything that belongs to the person, not the org.
 * Auth via Bearer token (same as useSource).
 *
 * Always hits the absolute gateway URL (appConfig.gatewayUrl) because
 * accounts is reached through the single my.construct.space gateway.
 */
export const useAccounts = () => {
  const baseURL = `${appConfig.gatewayUrl}/api/accounts`
  const authStore = useAuthStore()

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authStore.token) h.Authorization = `Bearer ${authStore.token}`
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
      throw new Error(err?.error || `Accounts API error (${resp.status})`)
    }
    const text = await resp.text()
    if (!text) return {} as T
    return JSON.parse(text) as T
  }

  return {
    get: <T = unknown>(endpoint: string) => request<T>(endpoint),
    post: <T = unknown>(endpoint: string, data?: unknown) => request<T>(endpoint, { method: 'POST', body: data }),
    put: <T = unknown>(endpoint: string, data?: unknown) => request<T>(endpoint, { method: 'PUT', body: data }),
    delete: <T = unknown>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
  }
}
