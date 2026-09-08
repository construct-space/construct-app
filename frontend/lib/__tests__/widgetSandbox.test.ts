import { describe, it, expect } from 'vitest'
import { BLOCKED_GLOBALS, detectBlockedGlobalAccess } from '../widgetSandbox'

describe('widgetSandbox', () => {
  it('BLOCKED_GLOBALS contains expected entries', () => {
    expect(BLOCKED_GLOBALS).toContain('__CONSTRUCT__')
    expect(BLOCKED_GLOBALS).toContain('__TAURI__')
    expect(BLOCKED_GLOBALS).toContain('Audio')
    expect(BLOCKED_GLOBALS).toContain('HTMLMediaElement')
    expect(BLOCKED_GLOBALS).toContain('parent')
    expect(BLOCKED_GLOBALS).toContain('top')
    expect(BLOCKED_GLOBALS).toContain('frames')
    expect(BLOCKED_GLOBALS).toContain('construct')
  })

  it('detectBlockedGlobalAccess catches window.__CONSTRUCT__', () => {
    const violations = detectBlockedGlobalAccess('const x = window.__CONSTRUCT__.auth')
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]).toContain('__CONSTRUCT__')
  })

  it('detectBlockedGlobalAccess catches window.__TAURI__', () => {
    const violations = detectBlockedGlobalAccess('window.__TAURI__.invoke("cmd")')
    expect(violations.length).toBeGreaterThan(0)
  })

  it('detectBlockedGlobalAccess catches eval', () => {
    const violations = detectBlockedGlobalAccess('eval("alert(1)")')
    expect(violations).toContain('Use of eval()')
  })

  it('detectBlockedGlobalAccess catches new Function', () => {
    const violations = detectBlockedGlobalAccess('const fn = new Function("return 1")')
    expect(violations).toContain('Use of new Function()')
  })

  it('detectBlockedGlobalAccess returns empty for clean code', () => {
    const violations = detectBlockedGlobalAccess('const x = api.theme.mode')
    expect(violations).toEqual([])
  })

  it('detectBlockedGlobalAccess catches globalThis access', () => {
    const violations = detectBlockedGlobalAccess('globalThis.Audio')
    expect(violations.length).toBeGreaterThan(0)
  })
})
