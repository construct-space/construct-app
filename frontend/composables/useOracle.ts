/**
 * useOracle — Global toggle state for the Oracle sidebar.
 * Singleton ref so the panel persists across navigation.
 */
import { ref } from 'vue'

export const showOracle = ref(false)

export function useOracle() {
  function toggle() { showOracle.value = !showOracle.value }
  function open() { showOracle.value = true }
  function close() { showOracle.value = false }

  return { visible: showOracle, toggle, open, close }
}
