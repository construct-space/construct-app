import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/utils/tauri', () => ({ isTauriEnv: () => false }))

const mockAuthStore = {
  token: null as string | null,
  user: null as unknown,
  isAuthenticated: false,
}
const mockProfileStore = { activeProfileId: '' }
const mockProjectStore = { openProject: vi.fn() }
const mockSetTheme = vi.fn()

vi.mock('@/stores/auth', () => ({ useAuthStore: () => mockAuthStore }))
vi.mock('@/stores/profile', () => ({ useProfileStore: () => mockProfileStore }))
vi.mock('@/stores/project', () => ({ useProjectStore: () => mockProjectStore }))
vi.mock('@construct-space/ui', () => ({
  useTheme: () => ({
    currentThemeId: { value: 'vs' },
    setTheme: mockSetTheme,
  }),
}))

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('childMirror (non-Tauri env)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthStore.token = null
    mockAuthStore.user = null
    mockAuthStore.isAuthenticated = false
    mockProfileStore.activeProfileId = ''
    mockProjectStore.openProject.mockReset()
    mockSetTheme.mockReset()
  })

  it('returns unlisten functions', async () => {
    const { startChildMirror } = await import('./childMirror')
    // In non-Tauri env: broadcast is a no-op, listen returns () => {}
    // startChildMirror should still resolve and return an array of functions
    const unlistens = await startChildMirror()
    expect(Array.isArray(unlistens)).toBe(true)
    // Clean up
    for (const fn of unlistens) fn()
  })

  it('all returned unlistens are callable functions', async () => {
    const { startChildMirror } = await import('./childMirror')
    const unlistens = await startChildMirror()
    for (const fn of unlistens) {
      expect(typeof fn).toBe('function')
      expect(() => fn()).not.toThrow()
    }
  })
})
