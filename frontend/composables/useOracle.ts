/**
 * useOracle — Global toggle state for the Chat sidebar panel.
 * Singleton ref so the panel persists across navigation.
 * Kept as useOracle for backward compat with auto-imports.
 */
import { ref } from 'vue'

export const showOracle = ref(false)

export function useOracle() {
  function toggle() { showOracle.value = !showOracle.value }
  function open() { showOracle.value = true }
  function close() { showOracle.value = false }

  return { visible: showOracle, toggle, open, close }
}
