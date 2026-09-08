import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const profileSwitchMock = vi.hoisted(() => ({
  events: [] as string[],
  invoke: vi.fn(async (command: string) => {
    if (command === 'switch_profile') {
      profileSwitchMock.events.push('desktop-switch')
      return '/profiles/profile-b'
    }
    return null
  }),
  brainRequest: vi.fn(async (_method: string, payload: { id: string }) => {
    profileSwitchMock.events.push(`brain:${payload.id}`)
  }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: profileSwitchMock.invoke,
}))

vi.mock('@/brain', () => ({
  useBrain: () => ({
    request: profileSwitchMock.brainRequest,
  }),
}))

vi.mock('@/lib/profileStorage', () => ({
  clearProfileStorage: vi.fn(),
  setActiveProfileId: vi.fn((id: string) => {
    profileSwitchMock.events.push(`frontend:${id}`)
  }),
  migrateLocalStorage: vi.fn(),
}))

vi.mock('@/lib/profileEvents', () => ({
  emitProfileChanged: vi.fn(async (id: string) => {
    profileSwitchMock.events.push(`emit:${id}`)
  }),
}))

vi.mock('@/lib/appPaths', () => ({
  initAppPaths: vi.fn(async () => {}),
}))

vi.mock('@/space_loader/SpaceLoader', () => ({
  resetDynamicSpacesForProfileSwitch: vi.fn(),
}))

vi.mock('@/composables/useTauriStore', () => ({
  resetTauriStore: vi.fn(async () => {}),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    clearAuthState: vi.fn(),
    initialize: vi.fn(async () => {}),
  }),
}))

vi.mock('@/stores/org', () => ({
  useOrgStore: () => ({
    onProfileSwitch: vi.fn(),
  }),
}))

vi.mock('@/stores/pinned', () => ({
  usePinnedStore: () => ({
    items: [],
    init: vi.fn(async () => {}),
  }),
}))

vi.mock('@/composables/useAppTheme', () => ({
  reloadThemeFromStorage: vi.fn(),
}))

describe('profile store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    profileSwitchMock.events = []
    profileSwitchMock.invoke.mockClear()
    profileSwitchMock.brainRequest.mockClear()
  })

  it('notifies brain before emitting the frontend active-profile change', async () => {
    const { useProfileStore } = await import('./profile')
    const profile = useProfileStore()

    await profile.switchProfile('profile-b')

    expect(profileSwitchMock.events).toEqual([
      'desktop-switch',
      'brain:profile-b',
      'frontend:profile-b',
      'emit:profile-b',
    ])
  })
})
