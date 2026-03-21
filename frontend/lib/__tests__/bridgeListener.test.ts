/**
 * Bridge Listener Tests
 *
 * Tests the request routing logic of the bridge listener.
 * Since bridgeListener.ts imports Tauri APIs at the top level, we mock them
 * and test the dispatch logic by extracting the handler.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock Tauri APIs before importing bridgeListener
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(async (_event: string, handler: (event: any) => void) => {
      // Store the handler so we can call it in tests
      ;(globalThis as any).__bridgeHandler = handler
      return () => {} // unlisten
    }),
  }),
}))

vi.mock('@tauri-apps/api/core', () => {
  const responses: Array<{ id: string; result: any }> = []
  return {
    invoke: vi.fn(async (_cmd: string, args: any) => {
      responses.push(args)
    }),
    __getResponses: () => responses,
    __clearResponses: () => { responses.length = 0 },
  }
})

import {
  registerAutomationProvider,
  setActiveSpace,
} from '../spaceContextBus'
import type { AutomationProvider, SpaceSnapshot, AutomationAction, ActionResult } from '@/types/automation'
import { startBridgeListener, stopBridgeListener } from '../bridgeListener'

// Helper to simulate a bridge request and capture the invoke response
async function simulateBridgeRequest(id: string, method: string, params?: Record<string, unknown>) {
  const handler = (globalThis as any).__bridgeHandler
  if (!handler) throw new Error('Bridge handler not registered — call startBridgeListener first')
  await handler({ payload: { id, method, params } })

  const { __getResponses } = await import('@tauri-apps/api/core') as any
  const responses = __getResponses()
  const response = responses.find((r: any) => r.id === id)
  return response
}

function makeTestProvider(): AutomationProvider {
  return {
    snapshot(): SpaceSnapshot {
      return {
        space_id: 'test-space',
        title: 'Test Space',
        state: { items: 3 },
        actions: ['test.do_thing'],
      }
    },
    listActions(): AutomationAction[] {
      return [
        { id: 'test.do_thing', description: 'Do a thing' },
        { id: 'test.other', description: 'Other action' },
      ]
    },
    async runAction(actionId: string, payload?: Record<string, unknown>): Promise<ActionResult> {
      if (actionId === 'test.do_thing') {
        return { success: true, data: { done: true, input: payload } }
      }
      return { success: false, error: `Unknown action: ${actionId}` }
    },
  }
}

describe('bridgeListener', () => {
  let unregProvider: (() => void) | null = null

  beforeEach(async () => {
    // Clear state
    const { __clearResponses } = await import('@tauri-apps/api/core') as any
    __clearResponses()
    stopBridgeListener()
    setActiveSpace(null)
    if (unregProvider) {
      unregProvider()
      unregProvider = null
    }
  })

  it('starts the listener and registers handler', async () => {
    await startBridgeListener()
    expect((globalThis as any).__bridgeHandler).toBeDefined()
  })

  it('is idempotent — calling start twice does not error', async () => {
    await startBridgeListener()
    await startBridgeListener() // second call is a no-op
    expect((globalThis as any).__bridgeHandler).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // space.snapshot
  // ---------------------------------------------------------------------------

  describe('space.snapshot', () => {
    it('returns snapshot from registered provider via explicit space_id', async () => {
      unregProvider = registerAutomationProvider('test-space', makeTestProvider())
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-1', 'space.snapshot', { space_id: 'test-space' })
      expect(resp.result).toMatchObject({
        space_id: 'test-space',
        title: 'Test Space',
      })
    })

    it('uses active space as fallback when no space_id given', async () => {
      unregProvider = registerAutomationProvider('test-space', makeTestProvider())
      setActiveSpace('test-space')
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-2', 'space.snapshot', {})
      expect(resp.result).toMatchObject({ space_id: 'test-space' })
    })

    it('returns error when no active space and no space_id', async () => {
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-3', 'space.snapshot', {})
      expect(resp.result).toHaveProperty('error')
      expect(resp.result.error).toMatch(/No active space/)
    })

    it('returns error when provider is not registered', async () => {
      setActiveSpace('no-provider')
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-4', 'space.snapshot', {})
      expect(resp.result).toHaveProperty('error')
      expect(resp.result.error).toMatch(/No automation provider/)
    })
  })

  // ---------------------------------------------------------------------------
  // space.list_actions
  // ---------------------------------------------------------------------------

  describe('space.list_actions', () => {
    it('returns action list from provider', async () => {
      unregProvider = registerAutomationProvider('test-space', makeTestProvider())
      setActiveSpace('test-space')
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-5', 'space.list_actions', {})
      expect(resp.result.actions).toHaveLength(2)
      expect(resp.result.actions[0].id).toBe('test.do_thing')
      expect(resp.result.space_id).toBe('test-space')
    })
  })

  // ---------------------------------------------------------------------------
  // space.run_action
  // ---------------------------------------------------------------------------

  describe('space.run_action', () => {
    it('runs a known action and returns result', async () => {
      unregProvider = registerAutomationProvider('test-space', makeTestProvider())
      setActiveSpace('test-space')
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-6', 'space.run_action', {
        action: 'test.do_thing',
        payload: { key: 'value' },
      })
      expect(resp.result).toMatchObject({ success: true, data: { done: true } })
    })

    it('returns error when action param is missing', async () => {
      unregProvider = registerAutomationProvider('test-space', makeTestProvider())
      setActiveSpace('test-space')
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-7', 'space.run_action', {})
      expect(resp.result).toHaveProperty('error')
      expect(resp.result.error).toMatch(/requires an "action" parameter/)
    })

    it('returns error for unknown action ID', async () => {
      unregProvider = registerAutomationProvider('test-space', makeTestProvider())
      setActiveSpace('test-space')
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-8', 'space.run_action', {
        action: 'nonexistent',
      })
      expect(resp.result).toMatchObject({ success: false, error: 'Unknown action: nonexistent' })
    })
  })

  // ---------------------------------------------------------------------------
  // Unknown method
  // ---------------------------------------------------------------------------

  describe('unknown methods', () => {
    it('returns error for unknown bridge method', async () => {
      await startBridgeListener()

      const resp = await simulateBridgeRequest('req-9', 'space.nonexistent', {})
      expect(resp.result).toHaveProperty('error')
      expect(resp.result.error).toMatch(/Unknown bridge method/)
    })
  })

  // ---------------------------------------------------------------------------
  // Space ID resolution
  // ---------------------------------------------------------------------------

  describe('space ID resolution', () => {
    it('prefers explicit space_id over active space', async () => {
      const providerA = makeTestProvider()
      const providerB: AutomationProvider = {
        snapshot: () => ({ space_id: 'other', title: 'Other', state: {}, actions: [] }),
        listActions: () => [],
        runAction: async () => ({ success: true }),
      }
      const unregA = registerAutomationProvider('test-space', providerA)
      const unregB = registerAutomationProvider('other', providerB)
      setActiveSpace('other') // active space is "other"
      await startBridgeListener()

      // But request explicitly targets "test-space"
      const resp = await simulateBridgeRequest('req-10', 'space.snapshot', { space_id: 'test-space' })
      expect(resp.result.space_id).toBe('test-space')

      unregA()
      unregB()
    })
  })
})
