// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- each `it` defines a
   disposable harness component; linting against "one per file" doesn't
   apply in test mocks. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

const themeMock = vi.hoisted(() => ({
  useTheme: vi.fn(() => ({ init: vi.fn() })),
}))
vi.mock('@construct-space/ui', () => themeMock)

const tauriEnvMock = vi.hoisted(() => ({ isTauriEnv: vi.fn(() => false) }))
vi.mock('@/utils/tauri', () => tauriEnvMock)

const appThemeMock = vi.hoisted(() => ({ initTheme: vi.fn() }))
vi.mock('@/composables/useAppTheme', () => ({
  useAppTheme: () => appThemeMock,
}))

const networkMock = vi.hoisted(() => ({ install: vi.fn() }))
vi.mock('@/composables/useNetworkStatus', () => ({
  useNetworkStatus: () => networkMock,
}))

import { useUniversalBootstrap } from './useUniversalBootstrap'

describe('useUniversalBootstrap', () => {
  beforeEach(() => {
    themeMock.useTheme.mockClear()
    tauriEnvMock.isTauriEnv.mockReturnValue(false)
    appThemeMock.initTheme.mockClear()
    networkMock.install.mockClear()
  })

  it('initializes theme on mount by default', async () => {
    const Comp = defineComponent({
      setup() { useUniversalBootstrap(); return () => h('div') },
    })
    const wrapper = mount(Comp)
    await nextTick()
    expect(appThemeMock.initTheme).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('skips theme init when disabled', async () => {
    const Comp = defineComponent({
      setup() { useUniversalBootstrap({ initTheme: false }); return () => h('div') },
    })
    mount(Comp)
    await nextTick()
    expect(appThemeMock.initTheme).not.toHaveBeenCalled()
  })

  it('mounts and unmounts cleanly outside Tauri', async () => {
    const Comp = defineComponent({
      setup() { useUniversalBootstrap(); return () => h('div') },
    })
    const wrapper = mount(Comp)
    await nextTick()
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('registers and removes the devtools keydown listener in Tauri env', async () => {
    tauriEnvMock.isTauriEnv.mockReturnValue(true)
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const Comp = defineComponent({
      setup() { useUniversalBootstrap(); return () => h('div') },
    })
    const wrapper = mount(Comp)
    await nextTick()
    expect(add.mock.calls.some(([evt]) => evt === 'keydown')).toBe(true)
    wrapper.unmount()
    expect(remove.mock.calls.some(([evt]) => evt === 'keydown')).toBe(true)
    add.mockRestore()
    remove.mockRestore()
  })
})
