/**
 * @vitest-environment jsdom
 *
 * keyGuard tests — wrapped window listeners must bypass when focus is in
 * an editable element and the key is a plain typing key; pass through
 * otherwise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Each test imports fresh so `installed` flag doesn't carry over between
// tests. Vitest's module cache + resetModules gives us that guarantee.
async function freshInstall() {
  vi.resetModules()
  const mod = await import('./keyGuard')
  mod.installKeyGuard()
  return mod
}

function dispatchKeydown(opts: Partial<KeyboardEventInit> = {}) {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts })
  window.dispatchEvent(ev)
  return ev
}

describe('keyGuard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('calls window keydown listeners when focus is not in an editable element', async () => {
    await freshInstall()
    const handler = vi.fn()
    window.addEventListener('keydown', handler)
    dispatchKeydown({ key: 'w' })
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', handler)
  })

  it('bypasses window keydown listeners when an input is focused (plain key)', async () => {
    await freshInstall()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(document.activeElement).toBe(input)

    const handler = vi.fn()
    window.addEventListener('keydown', handler)
    dispatchKeydown({ key: 'w' })
    expect(handler).not.toHaveBeenCalled()
    window.removeEventListener('keydown', handler)
  })

  it('still fires listeners for modifier-bearing keys (Cmd+K) even in an input', async () => {
    await freshInstall()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const handler = vi.fn()
    window.addEventListener('keydown', handler)
    dispatchKeydown({ key: 'k', metaKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', handler)
  })

  it('bypasses when a contenteditable is focused', async () => {
    await freshInstall()
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    div.tabIndex = 0
    document.body.appendChild(div)
    div.focus()

    const handler = vi.fn()
    window.addEventListener('keydown', handler)
    dispatchKeydown({ key: 'a' })
    expect(handler).not.toHaveBeenCalled()
    window.removeEventListener('keydown', handler)
  })

  it('removeEventListener unregisters the wrapped handler', async () => {
    await freshInstall()
    const handler = vi.fn()
    window.addEventListener('keydown', handler)
    window.removeEventListener('keydown', handler)
    dispatchKeydown({ key: 'w' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not affect non-key events', async () => {
    await freshInstall()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const handler = vi.fn()
    window.addEventListener('click', handler)
    window.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener('click', handler)
  })
})
