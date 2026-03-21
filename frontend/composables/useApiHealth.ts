/**
 * API Health Check Composable
 * Monitors API connectivity and health status
 */

import { appConfig } from '@/utils/config'

export interface ApiHealthState {
  isHealthy: boolean
  lastError: string | null
  retryAttempts: number
  lastChecked: Date | null
}

export function useApiHealth() {
  const apiBase = appConfig.apiBase

  const health = ref<ApiHealthState>({
    isHealthy: true,
    lastError: null,
    retryAttempts: 0,
    lastChecked: null
  })

  const checkApiHealth = async () => {
    try {
      const healthUrl = apiBase ? `${apiBase.replace(/\/api$/, '')}/health` : '/api/health'
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) throw new Error(`Health check failed: ${response.status}`)

      health.value = {
        isHealthy: true,
        lastError: null,
        retryAttempts: 0,
        lastChecked: new Date()
      }

      return true
    } catch (error) {
      health.value = {
        isHealthy: false,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        retryAttempts: health.value.retryAttempts + 1,
        lastChecked: new Date()
      }

      return false
    }
  }

  return {
    health,
    checkApiHealth
  }
}
