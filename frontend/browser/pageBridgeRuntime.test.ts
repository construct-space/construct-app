import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

function activeBridgeScript() {
  return readFileSync(
    resolve(__dirname, '../../desktop/src/browser_page_bridge.js'),
    'utf8',
  )
    .replaceAll('__TAB_ID__', JSON.stringify('tab-1'))
    .replaceAll('__WEBVIEW_LABEL__', JSON.stringify('webview-1'))
    .replaceAll('__STATE_EVENT__', JSON.stringify('browser:page-state'))
    .replaceAll('__POPUP_EVENT__', JSON.stringify('browser:open-popup'))
    .replaceAll('__LINK_CONTEXT_EVENT__', JSON.stringify('browser:link-context'))
    .replaceAll('__PAGE_CONTEXT_EVENT__', JSON.stringify('browser:page-context'))
    .replaceAll('__LOADING_EVENT__', JSON.stringify('browser:loading'))
}

describe('active browser page bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as typeof window & { __CONSTRUCT_BROWSER_BRIDGE__?: unknown }).__CONSTRUCT_BROWSER_BRIDGE__
    delete (window as typeof window & { __CONSTRUCT_TAURI_IPC__?: unknown }).__CONSTRUCT_TAURI_IPC__
    document.body.innerHTML = ''
  })

  it('keeps target=_blank interception alive if document-start DOM observation fails', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    ;(window as typeof window & {
      __CONSTRUCT_TAURI_IPC__?: { emit: (event: string, payload: unknown) => Promise<void> }
    }).__CONSTRUCT_TAURI_IPC__ = {
      emit: async (event, payload) => {
        emitted.push({ event, payload })
      },
    }

    const originalMutationObserver = window.MutationObserver
    class ThrowingMutationObserver {
      observe() {
        throw new Error('observer target not ready')
      }
      disconnect() {}
    }
    vi.stubGlobal('MutationObserver', ThrowingMutationObserver)

    expect(() => {
      // Indirect eval runs the bridge in the window global scope.
      ;(0, eval)(activeBridgeScript())
    }).not.toThrow()

    vi.stubGlobal('MutationObserver', originalMutationObserver)

    const link = document.createElement('a')
    link.href = 'https://example.com/docs'
    link.target = '_blank'
    document.body.appendChild(link)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(emitted).toContainEqual({
      event: 'browser:open-popup',
      payload: expect.objectContaining({
        tabId: 'tab-1',
        webviewLabel: 'webview-1',
        url: 'https://example.com/docs',
        via: 'target-blank',
        foreground: true,
      }),
    })
  })

  it('routes middle-click auxclick events to a background tab request', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    ;(window as typeof window & {
      __CONSTRUCT_TAURI_IPC__?: { emit: (event: string, payload: unknown) => Promise<void> }
    }).__CONSTRUCT_TAURI_IPC__ = {
      emit: async (event, payload) => {
        emitted.push({ event, payload })
      },
    }

    ;(0, eval)(activeBridgeScript())

    const link = document.createElement('a')
    link.href = 'https://example.com/background'
    document.body.appendChild(link)
    link.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(emitted).toContainEqual({
      event: 'browser:open-popup',
      payload: expect.objectContaining({
        url: 'https://example.com/background',
        via: 'target-blank',
        foreground: false,
      }),
    })
  })

  it('routes cmd-click normal links to a background tab request', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    ;(window as typeof window & {
      __CONSTRUCT_TAURI_IPC__?: { emit: (event: string, payload: unknown) => Promise<void> }
    }).__CONSTRUCT_TAURI_IPC__ = {
      emit: async (event, payload) => {
        emitted.push({ event, payload })
      },
    }

    ;(0, eval)(activeBridgeScript())

    const link = document.createElement('a')
    link.href = 'https://example.com/cmd'
    document.body.appendChild(link)
    link.dispatchEvent(new MouseEvent('click', {
      button: 0,
      bubbles: true,
      cancelable: true,
      metaKey: true,
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(emitted).toContainEqual({
      event: 'browser:open-popup',
      payload: expect.objectContaining({
        url: 'https://example.com/cmd',
        via: 'target-blank',
        foreground: false,
      }),
    })
  })

  it('uses the browser popup command when available so target=_blank reaches the browser shell', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const invoked: Array<{ command: string; payload: unknown }> = []
    ;(window as typeof window & {
      __CONSTRUCT_TAURI_IPC__?: {
        emit: (event: string, payload: unknown) => Promise<void>
        invoke: (command: string, payload: unknown) => Promise<void>
      }
    }).__CONSTRUCT_TAURI_IPC__ = {
      emit: async (event, payload) => {
        emitted.push({ event, payload })
      },
      invoke: async (command, payload) => {
        invoked.push({ command, payload })
      },
    }

    ;(0, eval)(activeBridgeScript())

    const link = document.createElement('a')
    link.href = 'https://example.com/popup'
    link.target = '_blank'
    document.body.appendChild(link)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(invoked).toContainEqual({
      command: 'browser_handle_popup',
      payload: {
        payload: expect.objectContaining({
          tabId: 'tab-1',
          webviewLabel: 'webview-1',
          url: 'https://example.com/popup',
          via: 'target-blank',
          foreground: true,
        }),
      },
    })
    expect(emitted).not.toContainEqual(expect.objectContaining({ event: 'browser:open-popup' }))
  })
})
