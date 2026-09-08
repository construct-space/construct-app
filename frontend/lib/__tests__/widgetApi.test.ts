import { describe, it, expect, vi } from 'vitest'
import { createBuiltinWidgetApi, createMarketplaceWidgetApi } from '../widgetApi'

describe('widgetApi', () => {
  it('createBuiltinWidgetApi returns frozen object with actions', () => {
    const navigate = vi.fn()
    const newSession = vi.fn()
    const openSpace = vi.fn()
    const api = createBuiltinWidgetApi({
      instanceId: 'widget-test-1',
      theme: { mode: 'dark', vars: {} },
      space: { id: 'aichat', name: 'AIChat', icon: 'brain' },
      actions: { navigate, newSession },
      openSpace,
    })

    expect(Object.isFrozen(api)).toBe(true)
    expect(api.instanceId).toBe('widget-test-1')
    expect(api.actions.navigate).toBeDefined()
    expect(api.actions.newSession).toBeDefined()
    api.openSpace('queue')
    expect(openSpace).toHaveBeenCalledWith('queue')
    expect(() => { (api as Record<string, unknown>).extra = true }).toThrow()
  })

  it('createMarketplaceWidgetApi returns frozen object without actions but with openSpace', () => {
    const openSpace = vi.fn()
    const api = createMarketplaceWidgetApi({
      instanceId: 'widget-test-2',
      theme: { mode: 'light', vars: {} },
      space: { id: 'blog', name: 'Blog', icon: 'book' },
      openSpace,
    })

    expect(Object.isFrozen(api)).toBe(true)
    expect(api.instanceId).toBe('widget-test-2')
    expect((api as Record<string, unknown>).actions).toBeUndefined()
    api.openSpace()
    expect(openSpace).toHaveBeenCalled()
    expect(() => { (api as Record<string, unknown>).extra = true }).toThrow()
  })

  it('theme vars are frozen', () => {
    const api = createBuiltinWidgetApi({
      instanceId: 'widget-test-3',
      theme: { mode: 'dark', vars: { '--app-accent': '#fff' } },
      space: { id: 'builder', name: 'Builder', icon: 'hammer' },
      actions: { navigate: vi.fn(), newSession: vi.fn() },
      openSpace: vi.fn(),
    })

    expect(Object.isFrozen(api.theme)).toBe(true)
    expect(Object.isFrozen(api.theme.vars)).toBe(true)
  })
})
