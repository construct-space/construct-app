/**
 * useConstructConfig — exposes app config to spaces via SDK
 */

import { appConfig } from '@/utils/config'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'

export function useConstructConfig() {
  return {
    graphUrl: appConfig.graphUrl,
    apiBase: appConfig.apiBase,
    spacesRegistryUrl: appConfig.spacesRegistryUrl,
    accountsUrl: appConfig.accountsUrl,
    freepikApiKey: appConfig.freepikApiKey,
  }
}

export function getConstructRuntime() {
  const authStore = useAuthStore()
  const projectStore = useProjectStore()

  return {
    config: {
      graphUrl: appConfig.graphUrl,
      apiBase: appConfig.apiBase,
    },
    auth: {
      async getAccessToken(): Promise<string | null> {
        return authStore.oauthToken || authStore.token
      },
      getUserId(): string | null {
        return authStore.user?.id?.toString() || null
      },
    },
    space: {
      id: '',
    },
    project: {
      id: projectStore.currentProject?.id?.toString() || 'default',
    },
  }
}
