/**
 * useAssistantPanel — host-side visibility for the assistant overlay.
 *
 * Chat lives in `@/brain/useBrainSession`; this module owns only the UI
 * plumbing — a shared `visible` ref + the detached-window opener — so
 * layouts/menus stay decoupled from the chat client.
 *
 * The exported `showAssistant` ref is the same singleton the device-bus
 * flips when another device asks the assistant.
 */

import { ref } from 'vue'
import { isTauriEnv } from '@/utils/tauri'

// Singleton — shared by every caller (layouts, menus, device bus).
export const showAssistant = ref(false)

export function useAssistantPanel() {
  function toggle() {
    showAssistant.value = !showAssistant.value
  }

  function open() {
    showAssistant.value = true
  }

  function close() {
    showAssistant.value = false
  }

  async function openInWindow() {
    // Close the panel immediately — the detached window is the new home.
    // We reopen on failure so the user isn't left with nothing.
    showAssistant.value = false

    if (!isTauriEnv()) {
      const popup = window.open('/#/detach/assistant', 'assistant-popout', 'width=480,height=700')
      if (!popup) showAssistant.value = true // blocked by browser
      else popup.focus()
      return
    }

    try {
      const { initiateDetach } = await import('@/lib/crossWindow/sessionHandoff')
      const sessionId = `assistant-${Date.now()}`
      await initiateDetach('assistant', sessionId)
    } catch (e) {
      showAssistant.value = true // reopen if detach failed
      console.error('[useAssistantPanel] Failed to open window:', e)
    }
  }

  return {
    visible: showAssistant,
    toggle,
    open,
    close,
    openInWindow,
  }
}
