import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// In-memory filesystem shared across the mocked Tauri fs + core plugins.
const fsMock = vi.hoisted(() => {
  const files = new Map<string, string>()
  return {
    files,
    reset() { files.clear() },
    invoke: vi.fn(async (command: string) => {
      if (command === 'get_data_dir') return '/data/profiles/me'
      return null
    }),
    exists: vi.fn(async (path: string) => fsMock.files.has(path) || path === '/data/profiles/me'),
    mkdir: vi.fn(async () => {}),
    readTextFile: vi.fn(async (path: string) => {
      const v = fsMock.files.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    }),
    writeTextFile: vi.fn(async (path: string, content: string) => { fsMock.files.set(path, content) }),
  }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: fsMock.invoke }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: fsMock.exists,
  mkdir: fsMock.mkdir,
  readTextFile: fsMock.readTextFile,
  writeTextFile: fsMock.writeTextFile,
}))
vi.mock('@/utils/tauri', () => ({ isTauriEnv: () => true }))

import { useAuthStore } from '@/stores/auth'

const AUTH_PATH = '/data/profiles/me/auth.json'

describe('persistAuthState publisher preservation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fsMock.reset()
    vi.clearAllMocks()
  })

  it('keeps an existing publisher block when re-persisting auth on token rotation', async () => {
    // A prior dev-mode sync wrote the org publisher key into auth.json.
    fsMock.files.set(AUTH_PATH, JSON.stringify({
      user: { id: '1', email: 'flak@construct.space' },
      token: 'cat_old',
      oauth_token: 'cat_old',
      authenticated: true,
      publisher: { name: 'Construct', kind: 'org', api_key: 'csk_live_abc' },
    }))

    const store = useAuthStore()
    store.user = { id: '1', email: 'flak@construct.space' } as never
    store.token = 'cat_new'
    store.oauthToken = 'cat_new'
    store.isAuthenticated = true

    await store.persistAuthState()

    const written = JSON.parse(fsMock.files.get(AUTH_PATH)!)
    // Rotated token landed...
    expect(written.token).toBe('cat_new')
    expect(written.oauth_token).toBe('cat_new')
    // ...without dropping the publisher key the CLI relies on.
    expect(written.publisher).toEqual({ name: 'Construct', kind: 'org', api_key: 'csk_live_abc' })
  })

  it('writes a valid file when none exists yet (no publisher to preserve)', async () => {
    const store = useAuthStore()
    store.user = { id: '1', email: 'flak@construct.space' } as never
    store.token = 'cat_new'
    store.oauthToken = 'cat_new'
    store.isAuthenticated = true

    await store.persistAuthState()

    const written = JSON.parse(fsMock.files.get(AUTH_PATH)!)
    expect(written.token).toBe('cat_new')
    expect(written.publisher).toBeUndefined()
  })
})
