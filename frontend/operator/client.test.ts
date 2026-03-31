import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let invokeMock = vi.fn()
const testGlobal = globalThis as unknown as { window?: { __TAURI__?: boolean } }

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ token: null }),
}))

describe('useOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'start_context_service') return '127.0.0.1:60100'
      if (cmd === 'send_context_request' && args?.requestType === 'system.ping') {
        return { status: 'ok', version: 'test-version' }
      }
      return {}
    })
    testGlobal.window = { __TAURI__: true }
  })

  afterEach(() => {
    delete testGlobal.window
  })

  it('does not read local keychain or codex tokens during connect', async () => {
    const { useOperator } = await import('./client')
    const operator = useOperator()

    await operator.connect()
    await new Promise(resolve => setTimeout(resolve, 0))

    const commands = invokeMock.mock.calls.map(([cmd]) => cmd)
    expect(commands).toContain('start_context_service')
    expect(commands).not.toContain('oauth_read_keychain')
    expect(commands).not.toContain('codex_read_tokens')
  })

  it('send() times out after configured timeout', async () => {
    // Make invoke hang forever
    invokeMock = vi.fn(() => new Promise(() => {}))
    testGlobal.window = { __TAURI__: true }

    const { useOperator } = await import('./client')
    const operator = useOperator()

    await expect(
      operator.send('test.slow', {}, { timeout: 50 }),
    ).rejects.toThrow(/timed out/)
  })

  it('send() emits error event on timeout', async () => {
    // Make invoke hang
    invokeMock = vi.fn(() => new Promise(() => {}))
    testGlobal.window = { __TAURI__: true }

    const { useOperator } = await import('./client')
    const operator = useOperator()

    const errors: Array<{ type: string; message: string; requestType?: string }> = []
    operator.onError((err) => { errors.push(err) })

    try {
      await operator.send('test.timeout', {}, { timeout: 50 })
    } catch { /* expected */ }

    expect(errors.length).toBe(1)
    expect(errors[0].type).toBe('timeout')
    expect(errors[0].requestType).toBe('test.timeout')
  })

  it('send() emits error event on failure', async () => {
    invokeMock = vi.fn(async () => { throw new Error('connection refused') })
    testGlobal.window = { __TAURI__: true }

    const { useOperator } = await import('./client')
    const operator = useOperator()

    const errors: Array<{ type: string; message: string; requestType?: string }> = []
    operator.onError((err) => { errors.push(err) })

    try {
      await operator.send('test.fail', {})
    } catch { /* expected */ }

    expect(errors.length).toBe(1)
    expect(errors[0].type).toBe('request_failed')
    expect(errors[0].requestType).toBe('test.fail')
  })

  it('onError unsubscribe works', async () => {
    invokeMock = vi.fn(async () => { throw new Error('fail') })
    testGlobal.window = { __TAURI__: true }

    const { useOperator } = await import('./client')
    const operator = useOperator()

    const errors: string[] = []
    const unsubscribe = operator.onError((err) => { errors.push(err.type) })

    try { await operator.send('test.1', {}) } catch { /* expected */ }
    expect(errors.length).toBe(1)

    unsubscribe()
    try { await operator.send('test.2', {}) } catch { /* expected */ }
    // Should still be 1 after unsubscribe
    expect(errors.length).toBe(1)
  })
})
