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
})
