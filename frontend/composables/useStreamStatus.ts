/**
 * useStreamStatus — frozen stub kept alive for MainShell.
 *
 * Permission UI now lives in `<PermissionGate>`, which talks to the
 * brain bridge directly. MainShell still mounts a legacy permission
 * Teleport that reads `pendingPermission` from this surface, so the
 * ref is real (assignable to `null` on dismiss) but the stream never
 * pushes events into it.
 *
 * TODO: when MainShell's legacy permission Teleport is removed, this
 * stub can go too.
 */

import { ref } from 'vue'

export interface PermissionRequestEvent {
  request_id: string
  tool: string
  input: string
  mode: string
  message: string
}

export function useStreamStatus() {
  const pendingPermission = ref<PermissionRequestEvent | null>(null)
  return { pendingPermission }
}
