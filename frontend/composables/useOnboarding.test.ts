import { describe, expect, test, beforeEach, vi } from 'vitest'
import { isOnboardingComplete, markOnboardingComplete, clearOnboarding } from './useOnboarding'

interface FakeStore {
  data: Map<string, unknown>
  get: <T>(k: string) => Promise<T | undefined>
  set: (k: string, v: unknown) => Promise<void>
  delete: (k: string) => Promise<void>
}

function makeStore(): FakeStore {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async <T,>(k: string) => data.get(k) as T | undefined,
    set: async (k, v) => { data.set(k, v) },
    delete: async (k) => { data.delete(k) },
  }
}

function createStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
}

let fakeStore: FakeStore | null = null

vi.mock('./useTauriStore', () => ({
  getTauriStore: async () => fakeStore,
}))

beforeEach(() => {
  fakeStore = makeStore()
  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorage(),
    configurable: true,
    writable: true,
  })
})

describe('useOnboarding', () => {
  test('returns false when never marked', async () => {
    expect(await isOnboardingComplete('user-1')).toBe(false)
  })

  test('marks and reads back', async () => {
    await markOnboardingComplete('user-1')
    expect(await isOnboardingComplete('user-1')).toBe(true)
  })

  test('migrates legacy localStorage value into the Tauri store', async () => {
    localStorage.setItem('cp_onboarding_complete:user-1', 'true')
    expect(await isOnboardingComplete('user-1')).toBe(true)
    // Migration removes the legacy key
    expect(localStorage.getItem('cp_onboarding_complete:user-1')).toBeNull()
    // And persists in the store
    expect(fakeStore!.data.get('onboarding_complete:user-1')).toBe(true)
  })

  test('clearOnboarding removes both the store entry and legacy key', async () => {
    await markOnboardingComplete('user-1')
    localStorage.setItem('cp_onboarding_complete:user-1', 'true')
    await clearOnboarding('user-1')
    expect(await isOnboardingComplete('user-1')).toBe(false)
    expect(localStorage.getItem('cp_onboarding_complete:user-1')).toBeNull()
  })

  test('falls back to localStorage when Tauri store is unavailable', async () => {
    fakeStore = null
    localStorage.setItem('cp_onboarding_complete:user-2', 'true')
    expect(await isOnboardingComplete('user-2')).toBe(true)

    await markOnboardingComplete('user-3')
    expect(localStorage.getItem('cp_onboarding_complete:user-3')).toBe('true')
  })

  test('empty userId is a no-op', async () => {
    await markOnboardingComplete('')
    expect(await isOnboardingComplete('')).toBe(false)
  })
})
