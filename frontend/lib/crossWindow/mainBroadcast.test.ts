// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────────

// Non-Tauri env: broadcast/listen no-ops immediately
vi.mock('@/utils/tauri', () => ({ isTauriEnv: () => false }))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    token: 'tok-123',
    user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
  }),
}))

vi.mock('@/stores/profile', () => ({
  useProfileStore: () => ({
    activeProfileId: 'p1',
    profiles: [{ id: 'p1', name: 'Alice' }],
  }),
}))

vi.mock('@/stores/project', () => ({
  useProjectStore: () => ({
    currentProject: { path: '/home/user/proj', name: 'proj', id: 'proj' },
  }),
}))

vi.mock('@construct-space/ui', () => ({
  useTheme: () => ({
    currentThemeId: { value: 'vs-dark' },
    setTheme: vi.fn(),
  }),
}))

// useAppTheme reaches into profileStorage → localStorage at module-eval
// time. In a fresh jsdom env localStorage is missing some methods, so
// stub the composable surface this test cares about and skip the
// custom-theme bootstrap entirely. mainBroadcast also watches
// `theme.currentThemeId.value`, so expose a ref-shaped stub.
vi.mock('@/composables/useAppTheme', () => ({
  useAppTheme: () => ({
    initTheme: vi.fn(),
    reloadThemeFromStorage: vi.fn(),
    currentThemeId: { value: 'vs-dark' },
  }),
  reloadThemeFromStorage: vi.fn(),
}))

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('mainBroadcast (non-Tauri env)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('startMainBroadcasts returns unlisten functions', async () => {
    const { startMainBroadcasts } = await import('./mainBroadcast')
    const unlistens = await startMainBroadcasts()
    expect(Array.isArray(unlistens)).toBe(true)
    expect(unlistens.length).toBeGreaterThan(0)
    for (const fn of unlistens) {
      expect(typeof fn).toBe('function')
      fn() // callable without error
    }
  })

  it('all returned unlistens are callable', async () => {
    const { startMainBroadcasts } = await import('./mainBroadcast')
    const unlistens = await startMainBroadcasts()
    for (const fn of unlistens) {
      expect(typeof fn).toBe('function')
      expect(() => fn()).not.toThrow()
    }
  })
})
