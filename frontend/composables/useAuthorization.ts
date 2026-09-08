/**
 * useAuthorization — simplified for personal local-first mode
 * All permission checks return true (single user, full access)
 */

export const useAuthorization = () => {
  const can = async (_resourceType: string, _action: string, _resourceId?: string | number): Promise<boolean> => true

  const canSync = (_resourceType: string, _action: string, _resourceId?: string): boolean => true

  const hasPermission = (_resourceType: string, _action: string): boolean => true

  const canMultiple = async (
    checks: Array<{ resourceType: string; action: string; resourceId?: string }>
  ): Promise<Record<string, boolean>> => {
    const results: Record<string, boolean> = {}
    for (const { resourceType, action, resourceId } of checks) {
      const key = `${resourceType}:${action}${resourceId ? `:${resourceId}` : ''}`
      results[key] = true
    }
    return results
  }

  const canAny = async (_checks: Array<{ resourceType: string; action: string; resourceId?: string }>): Promise<boolean> => true

  const canAll = async (_checks: Array<{ resourceType: string; action: string; resourceId?: string }>): Promise<boolean> => true

  const useCanReactive = (_resourceType: string, _action: string, _resourceId?: string) => computed(() => true)

  const usePermissionReactive = (_resourceType: string, _action: string) => computed(() => true)

  const initialize = async () => {
    // No-op in personal mode
  }

  const clearCache = () => {
    // No-op in personal mode
  }

  return {
    can,
    canSync,
    hasPermission,
    canMultiple,
    canAny,
    canAll,
    useCanReactive,
    usePermissionReactive,
    initialize,
    clearCache,
    authorizationStore: null,
    roles: computed(() => []),
    roleOptions: computed(() => []),
    isLoadingRoles: computed(() => false),
    isLoadingUserPermissions: computed(() => false),
  }
}
