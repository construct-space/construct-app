import { onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'

export interface BrowserShortcutHandlers {
  newTab: () => void
  closeTab: () => void
  reopenClosed: () => void
  focusAddress: () => void
  reload: (hard: boolean) => void
  back: () => void
  forward: () => void
  jumpTab: (n: number) => void
  nextTab: () => void
  prevTab: () => void
  zoom: (delta: -1 | 0 | 1) => void
  toggleFind: () => void
  toggleDevtools: () => void
  bookmarkCurrent: () => void
  openDownloads: () => void
}

function isMacOS(): boolean {
  return navigator.platform.toLowerCase().includes('mac')
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea') return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  // Check if element is an input-like field
  if (el instanceof HTMLInputElement && ['text', 'password', 'email'].includes(el.type)) return true
  return false
}

export function useBrowserShortcuts(handlers: BrowserShortcutHandlers) {
  const isMac = isMacOS()
  const isInComponentContext = getCurrentInstance() !== null

  const handleKeyDown = (event: KeyboardEvent) => {
    // Check both event.target and document.activeElement for editable elements
    let isEditable = false
    const eventTarget = event.target instanceof Element ? event.target : null
    if (eventTarget) {
      isEditable = isEditableElement(eventTarget)
    }
    if (!isEditable && typeof document !== 'undefined' && document.activeElement) {
      isEditable = isEditableElement(document.activeElement as Element | null)
    }

    const isMod = isMac ? event.metaKey : event.ctrlKey
    const isShift = event.shiftKey
    const isAlt = event.altKey

    if ((event.key.toLowerCase() === 'l' || event.key.toLowerCase() === 'e') && isMod) {
      event.preventDefault()
      handlers.focusAddress()
      return
    }

    if (event.key.toLowerCase() === 'w' && isMod) {
      event.preventDefault()
      handlers.closeTab()
      return
    }

    if (isEditable) return

    const key = event.key.toLowerCase()

    if (key === 't' && isMod && !isShift) {
      event.preventDefault()
      handlers.newTab()
    } else if (key === 't' && isMod && isShift) {
      event.preventDefault()
      handlers.reopenClosed()
    } else if (key === 'r' && isMod && !isShift) {
      event.preventDefault()
      handlers.reload(false)
    } else if (key === 'r' && isMod && isShift) {
      event.preventDefault()
      handlers.reload(true)
    } else if ((key === '[' || key === 'arrowleft') && isMod) {
      event.preventDefault()
      handlers.back()
    } else if ((key === ']' || key === 'arrowright') && isMod) {
      event.preventDefault()
      handlers.forward()
    } else if (key >= '1' && key <= '8' && isMod) {
      event.preventDefault()
      handlers.jumpTab(parseInt(key, 10))
    } else if (key === '9' && isMod) {
      event.preventDefault()
      handlers.jumpTab(-1)
    } else if ((key === ']' && isMod && isShift) || (key === 'tab' && event.ctrlKey && isShift)) {
      event.preventDefault()
      handlers.nextTab()
    } else if ((key === '[' && isMod && isShift) || (key === 'tab' && event.ctrlKey && !isShift)) {
      event.preventDefault()
      handlers.prevTab()
    } else if ((key === '=' || key === '+') && isMod) {
      event.preventDefault()
      handlers.zoom(1)
    } else if (key === '-' && isMod) {
      event.preventDefault()
      handlers.zoom(-1)
    } else if (key === '0' && isMod) {
      event.preventDefault()
      handlers.zoom(0)
    } else if (key === 'f' && isMod) {
      event.preventDefault()
      handlers.toggleFind()
    } else if ((key === 'i' && isMod && isAlt) || key === 'f12') {
      event.preventDefault()
      handlers.toggleDevtools()
    } else if (key === 'd' && isMod) {
      event.preventDefault()
      handlers.bookmarkCurrent()
    } else if (key === 'j' && isMod && isShift) {
      event.preventDefault()
      handlers.openDownloads()
    }
  }

  if (isInComponentContext) {
    onMounted(() => {
      window.addEventListener('keydown', handleKeyDown)
    })

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleKeyDown)
    })
  } else {
    // For testing or non-component usage, attach immediately
    window.addEventListener('keydown', handleKeyDown)
  }

  return {
    ...handlers,
    dispose: () => {
      window.removeEventListener('keydown', handleKeyDown)
    },
  }
}
