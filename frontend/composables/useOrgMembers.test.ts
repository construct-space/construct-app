import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { OrgMember } from '@/types/org'

vi.mock('@/composables/useSource', () => ({
  useSource: () => ({
    get: vi.fn(async () => []),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  }),
}))

describe('useOrgMembers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('normalizes missing member names with email or user id fallbacks', async () => {
    const { useOrgStore } = await import('@/stores/org')
    const { useOrgMembers } = await import('./useOrgMembers')
    const store = useOrgStore()
    store.hydrated = true
    store.members = [
      makeMember({ id: 'm1', user_id: 'u1', email: 'one@example.com', name: '' }),
      makeMember({ id: 'm2', user_id: 'u2', email: '', name: '' }),
    ]

    const orgMembers = useOrgMembers()

    expect(orgMembers.members.value[0].name).toBe('one@example.com')
    expect(orgMembers.members.value[1].name).toBe('u2')
    expect(orgMembers.byId('m1')?.name).toBe('one@example.com')
    expect(orgMembers.byUserId('u2')?.name).toBe('u2')
  })
})

function makeMember(overrides: Partial<OrgMember>): OrgMember {
  return {
    id: '',
    org_id: 'org-1',
    user_id: '',
    name: '',
    email: '',
    avatar: '',
    title: '',
    phone: '',
    bio: '',
    role: '',
    role_id: null,
    status: 'active',
    department_id: null,
    joined_at: '',
    last_active_at: '',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}
