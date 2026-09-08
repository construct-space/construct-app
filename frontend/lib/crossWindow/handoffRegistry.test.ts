import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerHandoff,
  getHandoff,
  hasHandoff,
  registeredSpaces,
  __resetHandoffRegistry,
  HandoffNotRegisteredError,
  type SpaceHandoffContract,
} from './handoffRegistry'

function makeContract(): SpaceHandoffContract {
  return {
    stopAndFinalize: async () => {},
    save: async (sessionId) => ({ spaceId: 'test', sessionId, payload: {} }),
    load: async () => {},
  }
}

describe('handoffRegistry', () => {
  beforeEach(() => __resetHandoffRegistry())

  it('returns null for an unregistered space', () => {
    expect(getHandoff('unknown')).toBeNull()
    expect(hasHandoff('unknown')).toBe(false)
  })

  it('stores and retrieves a registered contract', () => {
    const contract = makeContract()
    registerHandoff('assistant', contract)
    expect(getHandoff('assistant')).toBe(contract)
    expect(hasHandoff('assistant')).toBe(true)
  })

  it('replaces a previously-registered contract for the same spaceId', () => {
    const first = makeContract()
    const second = makeContract()
    registerHandoff('assistant', first)
    registerHandoff('assistant', second)
    expect(getHandoff('assistant')).toBe(second)
  })

  it('lists all registered spaces', () => {
    registerHandoff('assistant', makeContract())
    registerHandoff('coder', makeContract())
    expect(registeredSpaces().sort()).toEqual(['assistant', 'coder'])
  })

  it('HandoffNotRegisteredError carries the requested spaceId and registered list', () => {
    registerHandoff('assistant', makeContract())
    const err = new HandoffNotRegisteredError('coder', registeredSpaces())
    expect(err.message).toContain("'coder'")
    expect(err.message).toContain('assistant')
    expect(err.name).toBe('HandoffNotRegisteredError')
  })

  it('HandoffNotRegisteredError lists "<none>" when no contracts are registered', () => {
    const err = new HandoffNotRegisteredError('coder', [])
    expect(err.message).toContain('<none>')
  })
})
