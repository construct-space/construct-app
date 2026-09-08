import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initiateDetach, claim, listenForRelease, installDetachResponder } from './sessionHandoff'
import { registerHandoff, __resetHandoffRegistry } from './handoffRegistry'
import type { HandoffSnapshot, SpaceHandoffContract } from './handoffRegistry'

// ─── Mock sync primitives ─────────────────────────────────────────────────────

const emitToMock = vi.fn()
const listenMock = vi.fn()

vi.mock('./sync', () => ({
  channels: {
    sessionDetachReady: 'construct:session-detach-ready',
    sessionDetachRequest: 'construct:session-detach-request',
    sessionReleased: 'construct:session-released',
  },
  emitTo: (...args: unknown[]) => emitToMock(...args),
  listen: (...args: unknown[]) => listenMock(...args),
}))

// ─── Mock openWindow ──────────────────────────────────────────────────────────

const openWindowMock = vi.fn()

vi.mock('@/lib/window/openWindow', () => ({
  openWindow: (...args: unknown[]) => openWindowMock(...args),
}))

// ─── Mock Tauri webviewWindow ─────────────────────────────────────────────────

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'detach-assistant-sess_1' }),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContract(
  overrides: Partial<SpaceHandoffContract> = {},
): SpaceHandoffContract {
  return {
    stopAndFinalize: vi.fn(() => Promise.resolve()),
    save: vi.fn((_sessionId: string): Promise<HandoffSnapshot> =>
      Promise.resolve({ spaceId: 'assistant', sessionId: 'sess_1', payload: { turns: [] } }),
    ),
    load: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sessionHandoff', () => {
  beforeEach(() => {
    __resetHandoffRegistry()
    emitToMock.mockReset()
    openWindowMock.mockReset()
    listenMock.mockReset()
    emitToMock.mockResolvedValue(undefined)
    openWindowMock.mockResolvedValue({ label: 'detach-assistant-test', type: 'detach-assistant' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── initiateDetach ─────────────────────────────────────────────────────────

  describe('initiateDetach', () => {
    it('calls save → stash → openWindow (no broadcast)', async () => {
      const callOrder: string[] = []
      const contract = makeContract({
        save: vi.fn(async () => {
          callOrder.push('save')
          return { spaceId: 'assistant', sessionId: 'sess_1', payload: {} }
        }),
      })
      openWindowMock.mockImplementationOnce(async () => { callOrder.push('openWindow'); return {} })

      registerHandoff('assistant', contract)
      await initiateDetach('assistant', 'sess_1')

      expect(callOrder).toEqual(['save', 'openWindow'])
      // No broadcast should have been called
      expect(emitToMock).not.toHaveBeenCalledWith(
        expect.anything(),
        'construct:session-detach-ready',
        expect.anything(),
      )
    })

    it('stashes snapshot keyed by spaceId:sessionId (consumed by responder)', async () => {
      const snap: HandoffSnapshot = { spaceId: 'assistant', sessionId: 'sess_1', payload: { foo: 'bar' } }
      const contract = makeContract({ save: vi.fn(async () => snap) })
      registerHandoff('assistant', contract)

      // Install a responder listener that we can trigger manually
      let responderHandler: ((req: { spaceId: string; sessionId: string; targetLabel: string }) => void) | null = null
      listenMock.mockImplementationOnce(async (_ch: unknown, handler: unknown) => {
        responderHandler = handler as typeof responderHandler
        return () => {}
      })

      await installDetachResponder()
      await initiateDetach('assistant', 'sess_1')

      // Simulate the detach window requesting the snapshot
      await responderHandler!({ spaceId: 'assistant', sessionId: 'sess_1', targetLabel: 'detach-win' })

      expect(emitToMock).toHaveBeenCalledWith(
        'detach-win',
        'construct:session-detach-ready',
        snap,
      )
    })

    it('throws when no handoff registered', async () => {
      await expect(initiateDetach('assistant', 'sess_1')).rejects.toThrow(
        "No handoff registered for 'assistant'",
      )
    })

    it('opens detach-space window for non-assistant spaceId', async () => {
      const contract = makeContract({
        save: vi.fn(async () => ({ spaceId: 'coder', sessionId: 'sess_2', payload: {} })),
      })
      registerHandoff('coder', contract)

      await initiateDetach('coder', 'sess_2')

      expect(openWindowMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'detach-space', spaceId: 'coder', sessionId: 'sess_2' }),
      )
    })
  })

  // ─── installDetachResponder ─────────────────────────────────────────────────

  describe('installDetachResponder', () => {
    it('responds with targeted emitTo when request matches stashed snapshot', async () => {
      const snap: HandoffSnapshot = { spaceId: 'assistant', sessionId: 'sess_1', payload: { x: 1 } }
      const contract = makeContract({ save: vi.fn(async () => snap) })
      registerHandoff('assistant', contract)

      let responderHandler: ((req: { spaceId: string; sessionId: string; targetLabel: string }) => Promise<void>) | null = null
      listenMock.mockImplementationOnce(async (_ch: unknown, handler: unknown) => {
        responderHandler = handler as typeof responderHandler
        return () => {}
      })

      await installDetachResponder()

      // Stash via initiateDetach
      await initiateDetach('assistant', 'sess_1')

      // Now simulate the request from detach window
      await responderHandler!({ spaceId: 'assistant', sessionId: 'sess_1', targetLabel: 'my-detach' })

      expect(emitToMock).toHaveBeenCalledWith('my-detach', 'construct:session-detach-ready', snap)
    })

    it('warns and does not emit when no stashed snapshot found', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      let responderHandler: ((req: { spaceId: string; sessionId: string; targetLabel: string }) => Promise<void>) | null = null
      listenMock.mockImplementationOnce(async (_ch: unknown, handler: unknown) => {
        responderHandler = handler as typeof responderHandler
        return () => {}
      })

      await installDetachResponder()
      await responderHandler!({ spaceId: 'assistant', sessionId: 'missing', targetLabel: 'win' })

      expect(emitToMock).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        '[sessionHandoff] no pending detach for',
        expect.anything(),
      )
    })
  })

  // ─── claim ──────────────────────────────────────────────────────────────────

  describe('claim', () => {
    it('installs listener, then emits request to main, resolves when snapshot arrives', async () => {
      const snap: HandoffSnapshot = { spaceId: 'assistant', sessionId: 'sess_1', payload: { turns: [1] } }
      const callOrder: string[] = []

      // Capture the handler synchronously so we can fire it after the promise settles
      let capturedHandler: ((p: HandoffSnapshot) => void) | null = null

      // listen is called at top-level import level (not dynamic) — mock it
      listenMock.mockImplementation(async (_ch: unknown, handler: unknown) => {
        callOrder.push('listen')
        capturedHandler = handler as (p: HandoffSnapshot) => void
        return () => {}
      })
      emitToMock.mockImplementation(async (..._args: unknown[]) => {
        callOrder.push('emitTo-request')
      })

      const contract = makeContract()
      registerHandoff('assistant', contract)

      const claimPromise = claim('assistant', 'sess_1')

      // Flush microtasks so listener is installed and request is sent
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))

      expect(capturedHandler).toBeTypeOf('function')

      // Simulate the main responder targeting this window
      capturedHandler!(snap)

      await claimPromise

      expect(callOrder).toContain('listen')
      expect(callOrder).toContain('emitTo-request')
      // listen must come before emitTo
      expect(callOrder.indexOf('listen')).toBeLessThan(callOrder.indexOf('emitTo-request'))
      expect(emitToMock).toHaveBeenCalledWith('main', 'construct:session-detach-request', {
        spaceId: 'assistant',
        sessionId: 'sess_1',
        targetLabel: 'detach-assistant-sess_1',
      })
      expect(contract.load).toHaveBeenCalledWith(snap)
    })

    it('ignores events for different sessionId', async () => {
      let capturedHandler: ((p: HandoffSnapshot) => void) | null = null
      listenMock.mockImplementation(async (_ch: unknown, handler: unknown) => {
        capturedHandler = handler as (p: HandoffSnapshot) => void
        return () => {}
      })

      const contract = makeContract()
      registerHandoff('assistant', contract)

      const claimPromise = claim('assistant', 'sess_1')
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))

      expect(capturedHandler).toBeTypeOf('function')

      // Send wrong sessionId — should be ignored
      capturedHandler!({ spaceId: 'assistant', sessionId: 'OTHER', payload: {} })

      // Trigger the right one
      capturedHandler!({ spaceId: 'assistant', sessionId: 'sess_1', payload: {} })

      await claimPromise
      expect(contract.load).toHaveBeenCalledTimes(1)
    })

    it('rejects after CLAIM_TIMEOUT_MS when no event arrives', async () => {
      listenMock.mockImplementation(async () => () => {})
      emitToMock.mockImplementation(async () => {})

      const contract = makeContract()
      registerHandoff('assistant', contract)

      // Use a short timeout override by spying on the global setTimeout.
      // We replace the CLAIM_TIMEOUT_MS behaviour by verifying the reject message
      // without waiting the full 5 s: patch clearTimeout/setTimeout to fire immediately.
      const realSetTimeout = globalThis.setTimeout
       
      const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
        (fn: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
          return realSetTimeout(fn, 0, ...args) as unknown as ReturnType<typeof setTimeout>
        },
      )

      try {
        await expect(claim('assistant', 'sess_1')).rejects.toThrow('Timed out')
      } finally {
        timeoutSpy.mockRestore()
      }
    })
  })

  // ─── listenForRelease ───────────────────────────────────────────────────────

  describe('listenForRelease', () => {
    it('calls handoff.load and onRelease when sessionReleased fires', async () => {
      const snap: HandoffSnapshot = { spaceId: 'assistant', sessionId: 'sess_1', payload: { turns: [] } }
      let capturedHandler: ((p: HandoffSnapshot) => void) | null = null

      listenMock.mockImplementationOnce(async (_ch: unknown, handler: unknown) => {
        capturedHandler = handler as (p: HandoffSnapshot) => void
        return () => {}
      })

      const contract = makeContract()
      registerHandoff('assistant', contract)

      const onRelease = vi.fn(async () => {})
      await listenForRelease(onRelease)

      capturedHandler!(snap)
      await Promise.resolve()
      await Promise.resolve()

      expect(contract.load).toHaveBeenCalledWith(snap)
      expect(onRelease).toHaveBeenCalledWith(snap)
    })
  })
})
