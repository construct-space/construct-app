import { describe, it, expect, beforeEach } from 'vitest'
import { resolveSpec, validateSpec } from './openWindow'
import {
  registerHandoff,
  __resetHandoffRegistry,
  type SpaceHandoffContract,
} from '@/lib/crossWindow/handoffRegistry'

function stubContract(): SpaceHandoffContract {
  return {
    stopAndFinalize: async () => {},
    save: async (sessionId: string) => ({ spaceId: 'x', sessionId, payload: {} }),
    load: async () => {},
  }
}

describe('resolveSpec', () => {
  it('constructs space-preview URL with encoded projectPath', () => {
    const r = resolveSpec({
      type: 'space-preview',
      spaceId: 'coder',
      projectPath: '/Users/me/my space',
    })
    expect(r.label).toBe('preview-coder')
    expect(r.url).toContain('/#/preview/coder')
    expect(r.url).toContain(`dir=${encodeURIComponent('/Users/me/my space')}`)
    expect(r.focusExistingBy).toBe('spaceId')
  })

  it('constructs space-preview URL without dir when projectPath omitted', () => {
    const r = resolveSpec({ type: 'space-preview', spaceId: 'coder' })
    expect(r.url).toBe('/#/preview/coder')
  })

  it('detach-space label uses prefix + spaceId + nonce; URL carries session', () => {
    const r = resolveSpec({ type: 'detach-space', spaceId: 'coder', sessionId: 'sess_1' })
    expect(r.label).toMatch(/^detach-space-coder-/)
    expect(r.url).toContain('/#/detach/space/coder')
    expect(r.url).toContain('session=sess_1')
    expect(r.focusExistingBy).toBe('sessionId')
  })

  it('detach-space URL encodes project path when provided', () => {
    const r = resolveSpec({
      type: 'detach-space',
      spaceId: 'coder',
      sessionId: 'sess_1',
      project: '/tmp/proj space',
    })
    expect(r.url).toContain(`project=${encodeURIComponent('/tmp/proj space')}`)
  })

  it('detach-assistant uses detach-assistant- prefix and /#/detach/assistant URL', () => {
    const r = resolveSpec({ type: 'detach-assistant', sessionId: 'sess_2' })
    expect(r.label).toMatch(/^detach-assistant-/)
    expect(r.url).toContain('/#/detach/assistant')
    expect(r.url).toContain('session=sess_2')
    expect(r.focusExistingBy).toBe('sessionId')
  })

  it('browser URL targets the dedicated browser shell with encoded target URL', () => {
    const r = resolveSpec({ type: 'browser', url: 'https://google.com/?q=hi' })
    expect(r.label).toMatch(/^browser-/)
    expect(r.url).toContain('/browser.html?')
    expect(r.url).toContain('mode=browser')
    expect(r.url).toContain(encodeURIComponent('https://google.com/?q=hi'))
    expect(r.focusExistingBy).toBeNull()
  })

  it('browser can open without an initial URL', () => {
    const r = resolveSpec({ type: 'browser' })
    expect(r.label).toMatch(/^browser-/)
    expect(r.url).toBe('/browser.html?mode=browser')
    expect(r.focusExistingBy).toBeNull()
  })

  it('assigns sane default sizes per type', () => {
    expect(resolveSpec({ type: 'space-preview', spaceId: 'x' }).width).toBe(1100)
    expect(resolveSpec({ type: 'detach-space', spaceId: 'x', sessionId: 's' }).width).toBe(1200)
    expect(resolveSpec({ type: 'detach-assistant', sessionId: 's' }).width).toBe(480)
    expect(resolveSpec({ type: 'browser', url: 'https://x.com' }).width).toBe(1200)
  })
})

describe('validateSpec', () => {
  beforeEach(() => __resetHandoffRegistry())

  it('detach-space rejects when no handoff is registered', () => {
    expect(() =>
      validateSpec({ type: 'detach-space', spaceId: 'coder', sessionId: 's' }),
    ).toThrow(/No handoff contract registered for space 'coder'/)
  })

  it('detach-space accepts when handoff is registered', () => {
    registerHandoff('coder', stubContract())
    expect(() =>
      validateSpec({ type: 'detach-space', spaceId: 'coder', sessionId: 's' }),
    ).not.toThrow()
  })

  it('detach-assistant rejects when no assistant handoff registered', () => {
    expect(() =>
      validateSpec({ type: 'detach-assistant', sessionId: 's' }),
    ).toThrow(/'assistant'/)
  })

  it('detach-assistant accepts when assistant handoff registered', () => {
    registerHandoff('assistant', stubContract())
    expect(() =>
      validateSpec({ type: 'detach-assistant', sessionId: 's' }),
    ).not.toThrow()
  })

  it('browser rejects malformed URLs', () => {
    expect(() => validateSpec({ type: 'browser', url: 'not a url' }))
      .toThrow(/Invalid browser URL/)
  })

  it('browser rejects disallowed protocols', () => {
    expect(() => validateSpec({ type: 'browser', url: 'file:///etc/passwd' }))
      .toThrow(/Disallowed browser protocol 'file:'/)
    expect(() => validateSpec({ type: 'browser', url: 'javascript:alert(1)' }))
      .toThrow(/Disallowed browser protocol/)
  })

  it('browser accepts http and https', () => {
    expect(() => validateSpec({ type: 'browser', url: 'http://localhost:3000' })).not.toThrow()
    expect(() => validateSpec({ type: 'browser', url: 'https://example.com' })).not.toThrow()
  })

  it('browser accepts an omitted initial URL', () => {
    expect(() => validateSpec({ type: 'browser' })).not.toThrow()
  })

  it('space-preview does not require a handoff', () => {
    expect(() => validateSpec({ type: 'space-preview', spaceId: 'whatever' })).not.toThrow()
  })
})
