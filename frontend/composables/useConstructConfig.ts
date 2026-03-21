/**
 * useConstructConfig — exposes app config to spaces via SDK
 * Spaces import this to get PaaS URL, API base, etc.
 */

import { appConfig } from '@/utils/config'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'

export function useConstructConfig() {
  return {
    /** PaaS API URL for data module */
    paasUrl: appConfig.paasUrl,
    /** Main API base URL */
    apiBase: appConfig.apiBase,
    /** Spaces registry URL */
    spacesRegistryUrl: appConfig.spacesRegistryUrl,
    /** Accounts URL */
    accountsUrl: appConfig.accountsUrl,
    /** Freepik API key (for media generation) */
    freepikApiKey: appConfig.freepikApiKey,
  }
}

/**
 * getConstructRuntime — returns the full runtime context for SDK composables
 * This is what `construct.config`, `construct.auth`, `construct.space`, `construct.project`
 * resolve to inside space composables.
 */
export function getConstructRuntime() {
  const authStore = useAuthStore()
  const projectStore = useProjectStore()

  return {
    config: {
      paasUrl: appConfig.paasUrl,
      apiBase: appConfig.apiBase,
    },
    auth: {
      async getAccessToken(): Promise<string | null> {
        return authStore.token
      },
      getUserId(): string | null {
        return authStore.user?.id?.toString() || null
      },
    },
    space: {
      id: '', // Set per-space at load time
    },
    project: {
      id: projectStore.currentProject?.id?.toString() || 'default',
    },
  }
}
