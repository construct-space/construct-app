import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderCard } from './useProviderCard'

const storage = vi.hoisted(() => new Map<string, string>())

vi.mock('@/brain', () => ({
  useBrain: () => ({
    request: vi.fn(),
    stream: vi.fn(),
  }),
}))

vi.mock('@/lib/profileStorage', () => ({
  profileStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  },
}))

describe('useProviderCard', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('collapses provider cards by default and persists explicit toggles', () => {
    const card = useProviderCard()

    expect(card.isCollapsed('zai')).toBe(true)

    card.toggleCollapsed('zai')

    expect(card.isCollapsed('zai')).toBe(false)
    expect(storage.get('cp_provider_collapsed:zai')).toBe('false')
  })
})
