/**
 * useToolbarPrefs — UI prefs for the runtime toolbar chips (ContextGauge
 * + CostBadge). Kept in the shared storage so the setting survives
 * reloads and is visible from both the settings page and the chips
 * themselves without prop-drilling or a one-off Pinia store.
 *
 * Exposes a single boolean today (`showRuntimeChips`). Users who find
 * the context% / $cost chips distracting — especially on small
 * screens — can flip it off in Appearance settings; the toolbar still
 * renders PermissionControl during an active session, which is the
 * only piece you actually *act on*.
 */

import type { Ref } from 'vue'
import { useLocalStorage } from '@/composables/useLocalStorage'

export interface ToolbarPrefs {
  showRuntimeChips: Ref<boolean>
}

export function useToolbarPrefs(): ToolbarPrefs {
  const storage = useLocalStorage()
  // Default ON — the chips are useful most of the time; users who opt
  // out are a minority and should have to turn them off once.
  const showRuntimeChips = storage.reactive<boolean>(
    'toolbar.show_runtime_chips',
    true,
    { category: 'appearance' },
  )
  return { showRuntimeChips }
}
