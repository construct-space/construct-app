import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/composables/useSource', () => ({
  useSource: () => ({
    get: vi.fn(async () => []),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  }),
}))

describe('useOrgRoles', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    if (typeof globalThis.localStorage?.clear === 'function') {
      globalThis.localStorage.clear()
    }
  })

  it('matches scope role keys case-insensitively', async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const { useOrgStore } = await import('@/stores/org')
    const { useOrgRoles } = await import('./useOrgRoles')

    const auth = useAuthStore()
    const org = useOrgStore()
    auth.roles = ['pm']
    org.hydrated = true
    org.roles = [
      {
        id: 'role-pm',
        org_id: 'org-1',
        name: 'PM',
        description: '',
        is_builtin: true,
        permissions: ['projects.view'],
        created_at: '',
        updated_at: '',
      },
    ]

    const roles = useOrgRoles()

    expect(roles.byName('pm')?.id).toBe('role-pm')
    expect(roles.can('projects.view')).toBe(true)
  })

  it('honors wildcard permissions for active org roles', async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const { useOrgStore } = await import('@/stores/org')
    const { useOrgRoles } = await import('./useOrgRoles')

    const auth = useAuthStore()
    const org = useOrgStore()
    auth.roles = ['pm']
    org.hydrated = true
    org.roles = [
      {
        id: 'role-pm',
        org_id: 'org-1',
        name: 'PM',
        description: '',
        is_builtin: true,
        permissions: ['projects.*'],
        created_at: '',
        updated_at: '',
      },
    ]

    const roles = useOrgRoles()

    expect(roles.can('projects.create')).toBe(true)
    expect(roles.can('org.delete')).toBe(false)
  })
})
