/**
 * Simplified permission composable — personal local-first mode
 * All permissions return true (no role-based access control)
 */

export const usePermissions = () => {
  const can = (_resource: string, _action: string): boolean => true

  const canReactive = (_resource: string, _action: string) => computed(() => true)

  const canAny = (_permissions: [string, string][]): boolean => true

  const canAll = (_permissions: [string, string][]): boolean => true

  const canAnyReactive = (_permissions: [string, string][]) => computed(() => true)

  const canAllReactive = (_permissions: [string, string][]) => computed(() => true)

  const ui = {
    canAccessCustomers: computed(() => true),
    canAccessOrders: computed(() => true),
    canAccessPlans: computed(() => true),
    canAccessEmployees: computed(() => true),
    canAccessSettings: computed(() => true),
    canAccessReports: computed(() => true),
    canCreateCustomer: computed(() => true),
    canCreateOrder: computed(() => true),
    canCreatePlan: computed(() => true),
    canCreateEmployee: computed(() => true),
    canManageRoles: computed(() => true),
    canManageUsers: computed(() => true),
  }

  return {
    can,
    canReactive,
    canAny,
    canAll,
    canAnyReactive,
    canAllReactive,
    ui
  }
}
