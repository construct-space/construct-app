/**
 * useToastPrefs — where the transient toast stack (host <Notification />)
 * anchors on screen. Kept in shared storage so the choice survives reloads
 * and is readable from both Appearance settings and the renderer without a
 * one-off Pinia store. All toasts — host-emitted and space-SDK ones via
 * useToast() — render through the single <Notification /> surface, so this
 * one preference moves every toast.
 *
 * Default is bottom-right: top-right overlapped the Spaces toolbar
 * (Sync Org Spaces / SpaceStore / check-updates).
 */

import type { Ref } from 'vue'
import { useLocalStorage } from '@/composables/useLocalStorage'

export type ToastPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'

export const TOAST_POSITION_OPTIONS: { label: string; value: ToastPosition }[] = [
  { label: 'Bottom right', value: 'bottom-right' },
  { label: 'Bottom left', value: 'bottom-left' },
  { label: 'Top right', value: 'top-right' },
  { label: 'Top left', value: 'top-left' },
]

export interface ToastPrefs {
  toastPosition: Ref<ToastPosition>
}

export function useToastPrefs(): ToastPrefs {
  const storage = useLocalStorage()
  const toastPosition = storage.reactive<ToastPosition>(
    'toast.position',
    'bottom-right',
    { category: 'appearance' },
  )
  return { toastPosition }
}
