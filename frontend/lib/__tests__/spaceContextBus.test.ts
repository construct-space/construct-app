import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  publishSpaceContext,
  subscribeSpaceContext,
  getLatestSpaceContext,
  registerContextHandler,
  requestSpaceData,
  registerAutomationProvider,
  getAutomationProvider,
  listAutomationProviders,
  setActiveSpace,
  getActiveSpace,
} from '../spaceContextBus'
import type { AutomationProvider, SpaceSnapshot, AutomationAction, ActionResult } from '@/types/automation'

// Reset module-level state between tests by re-importing
// Since spaceContextBus uses module singletons, we isolate via vi.resetModules
// For this test we rely on cleanup within each test

function makeProvider(spaceId: string): AutomationProvider {
  return {
    snapshot(): SpaceSnapshot {
      return {
        space_id: spaceId,
        title: `${spaceId} space`,
        state: { test: true },
        actions: ['test.action'],
      }
    },
    listActions(): AutomationAction[] {
      return [{ id: 'test.action', description: 'A test action' }]
    },
    async runAction(actionId: string): Promise<ActionResult> {
      if (actionId === 'test.action') {
        return { success: true, data: { ran: true } }
      }
      return { success: false, error: `Unknown: ${actionId}` }
    },
  }
}

describe('spaceContextBus', () => {
  // ---------------------------------------------------------------------------
  // Publish / Subscribe
  // ---------------------------------------------------------------------------

  describe('publish and subscribe', () => {
    it('delivers published context to type-specific subscribers', () => {
      const cb = vi.fn()
      const unsub = subscribeSpaceContext('test-type', cb)

      publishSpaceContext({
        spaceId: 'project',
        type: 'test-type',
        summary: { count: 1 },
        timestamp: Date.now(),
      })

      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb.mock.calls[0][0].summary).toEqual({ count: 1 })

      unsub()
    })

    it('does not deliver to subscribers of a different type', () => {
      const cb = vi.fn()
      const unsub = subscribeSpaceContext('other-type', cb)

      publishSpaceContext({
        spaceId: 'project',
        type: 'test-type',
        summary: {},
        timestamp: Date.now(),
      })

      expect(cb).not.toHaveBeenCalled()
      unsub()
    })

    it('delivers to wildcard subscribers for all types', () => {
      const cb = vi.fn()
      const unsub = subscribeSpaceContext('*', cb)

      publishSpaceContext({ spaceId: 'a', type: 'alpha', summary: {}, timestamp: 1 })
      publishSpaceContext({ spaceId: 'b', type: 'beta', summary: {}, timestamp: 2 })

      expect(cb).toHaveBeenCalledTimes(2)
      unsub()
    })

    it('unsubscribe stops delivery', () => {
      const cb = vi.fn()
      const unsub = subscribeSpaceContext('x', cb)

      publishSpaceContext({ spaceId: 's', type: 'x', summary: {}, timestamp: 1 })
      expect(cb).toHaveBeenCalledTimes(1)

      unsub()
      publishSpaceContext({ spaceId: 's', type: 'x', summary: {}, timestamp: 2 })
      expect(cb).toHaveBeenCalledTimes(1) // not called again
    })

    it('stores latest context per type', () => {
      publishSpaceContext({ spaceId: 's', type: 'latest-test', summary: { v: 1 }, timestamp: 1 })
      publishSpaceContext({ spaceId: 's', type: 'latest-test', summary: { v: 2 }, timestamp: 2 })

      const ctx = getLatestSpaceContext('latest-test')
      expect(ctx?.summary).toEqual({ v: 2 })
    })

    it('returns undefined for unknown context type', () => {
      expect(getLatestSpaceContext('nonexistent-type-xyz')).toBeUndefined()
    })

    it('swallows listener errors without breaking delivery to other listeners', () => {
      const good = vi.fn()
      const bad = vi.fn(() => { throw new Error('boom') })

      const unsub1 = subscribeSpaceContext('err-test', bad)
      const unsub2 = subscribeSpaceContext('err-test', good)

      publishSpaceContext({ spaceId: 's', type: 'err-test', summary: {}, timestamp: 1 })

      expect(bad).toHaveBeenCalled()
      expect(good).toHaveBeenCalled()

      unsub1()
      unsub2()
    })
  })

  // ---------------------------------------------------------------------------
  // Request / Response
  // ---------------------------------------------------------------------------

  describe('request and response', () => {
    it('routes requests to registered handler', async () => {
      const handler = vi.fn(async (req) => ({ answer: req.type }))
      const unreg = registerContextHandler('my-space', handler)

      const result = await requestSpaceData('my-space', { type: 'query' })
      expect(result).toEqual({ answer: 'query' })

      unreg()
    })

    it('returns undefined for unregistered space', async () => {
      const result = await requestSpaceData('no-such-space-xyz')
      expect(result).toBeUndefined()
    })

    it('unregister removes the handler', async () => {
      const handler = vi.fn(async () => 'data')
      const unreg = registerContextHandler('temp-space', handler)
      unreg()

      const result = await requestSpaceData('temp-space')
      expect(result).toBeUndefined()
    })

    it('catches handler errors and returns undefined', async () => {
      const unreg = registerContextHandler('failing-space', async () => {
        throw new Error('handler crash')
      })

      const result = await requestSpaceData('failing-space', { type: 'test' })
      expect(result).toBeUndefined()

      unreg()
    })
  })

  // ---------------------------------------------------------------------------
  // Automation Providers
  // ---------------------------------------------------------------------------

  describe('automation providers', () => {
    it('registers and retrieves a provider', () => {
      const provider = makeProvider('test')
      const unreg = registerAutomationProvider('test', provider)

      expect(getAutomationProvider('test')).toBe(provider)

      unreg()
    })

    it('lists registered provider IDs', () => {
      const unreg1 = registerAutomationProvider('alpha', makeProvider('alpha'))
      const unreg2 = registerAutomationProvider('beta', makeProvider('beta'))

      const list = listAutomationProviders()
      expect(list).toContain('alpha')
      expect(list).toContain('beta')

      unreg1()
      unreg2()
    })

    it('unregister removes the provider', () => {
      const unreg = registerAutomationProvider('temp', makeProvider('temp'))
      unreg()

      expect(getAutomationProvider('temp')).toBeUndefined()
      expect(listAutomationProviders()).not.toContain('temp')
    })

    it('returns undefined for unknown provider', () => {
      expect(getAutomationProvider('nonexistent-xyz')).toBeUndefined()
    })

    it('provider snapshot returns correct structure', () => {
      const provider = makeProvider('project')
      const unreg = registerAutomationProvider('project', provider)

      const snap = provider.snapshot()
      expect(snap).toMatchObject({
        space_id: 'project',
        title: 'project space',
        actions: ['test.action'],
      })
      expect(snap.state).toEqual({ test: true })

      unreg()
    })

    it('provider listActions returns action definitions', () => {
      const provider = makeProvider('project')
      const actions = provider.listActions()
      expect(actions).toHaveLength(1)
      expect(actions[0]).toMatchObject({ id: 'test.action', description: 'A test action' })
    })

    it('provider runAction returns success for known action', async () => {
      const provider = makeProvider('project')
      const result = await provider.runAction('test.action')
      expect(result).toEqual({ success: true, data: { ran: true } })
    })

    it('provider runAction returns error for unknown action', async () => {
      const provider = makeProvider('project')
      const result = await provider.runAction('nope')
      expect(result).toEqual({ success: false, error: 'Unknown: nope' })
    })
  })

  // ---------------------------------------------------------------------------
  // Active Space Tracking
  // ---------------------------------------------------------------------------

  describe('active space tracking', () => {
    beforeEach(() => {
      setActiveSpace(null)
    })

    it('starts with null', () => {
      expect(getActiveSpace()).toBeNull()
    })

    it('set and get active space', () => {
      setActiveSpace('code')
      expect(getActiveSpace()).toBe('code')
    })

    it('can clear active space', () => {
      setActiveSpace('project')
      setActiveSpace(null)
      expect(getActiveSpace()).toBeNull()
    })

    it('can change active space', () => {
      setActiveSpace('project')
      setActiveSpace('code')
      expect(getActiveSpace()).toBe('code')
    })
  })
})
