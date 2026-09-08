import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBrowserShortcuts } from './composables/useBrowserShortcuts'

// @vitest-environment jsdom

describe('useBrowserShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('triggers newTab on Cmd+T (macOS)', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    const handlers = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      reopenClosed: vi.fn(),
      focusAddress: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      jumpTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      zoom: vi.fn(),
      toggleFind: vi.fn(),
      toggleDevtools: vi.fn(),
      bookmarkCurrent: vi.fn(),
      openDownloads: vi.fn(),
    }

    const { dispose } = useBrowserShortcuts(handlers)

    const event = new KeyboardEvent('keydown', {
      key: 't',
      metaKey: true,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(handlers.newTab).toHaveBeenCalled()
    dispose()
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform)
    }
  })

  it('ignores shortcuts when input is focused', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    const handlers = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      reopenClosed: vi.fn(),
      focusAddress: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      jumpTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      zoom: vi.fn(),
      toggleFind: vi.fn(),
      toggleDevtools: vi.fn(),
      bookmarkCurrent: vi.fn(),
      openDownloads: vi.fn(),
    }

    const { dispose } = useBrowserShortcuts(handlers)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const event = new KeyboardEvent('keydown', {
      key: 't',
      metaKey: true,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(handlers.newTab).not.toHaveBeenCalled()

    dispose()
    document.body.removeChild(input)
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform)
    }
  })

  it('allows Cmd+L even when input is focused', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    const handlers = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      reopenClosed: vi.fn(),
      focusAddress: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      jumpTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      zoom: vi.fn(),
      toggleFind: vi.fn(),
      toggleDevtools: vi.fn(),
      bookmarkCurrent: vi.fn(),
      openDownloads: vi.fn(),
    }

    const { dispose } = useBrowserShortcuts(handlers)

    const input = document.createElement('input')
    input.focus()
    document.body.appendChild(input)

    const event = new KeyboardEvent('keydown', {
      key: 'l',
      metaKey: true,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(handlers.focusAddress).toHaveBeenCalled()

    dispose()
    document.body.removeChild(input)
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform)
    }
  })

  it('maps Ctrl to Cmd on non-macOS', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    })

    const handlers = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      reopenClosed: vi.fn(),
      focusAddress: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      jumpTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      zoom: vi.fn(),
      toggleFind: vi.fn(),
      toggleDevtools: vi.fn(),
      bookmarkCurrent: vi.fn(),
      openDownloads: vi.fn(),
    }

    const { dispose } = useBrowserShortcuts(handlers)

    const event = new KeyboardEvent('keydown', {
      key: 't',
      ctrlKey: true,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(handlers.newTab).toHaveBeenCalled()

    dispose()
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform)
    }
  })
})
