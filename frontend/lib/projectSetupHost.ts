/**
 * Project setup host — owns the single app-level instance of
 * ProjectCreateModal and exposes a promise-based request API for the
 * bridge listener and anything else that needs to open the modal.
 *
 * The modal is rendered by ProjectSetupHost.vue (mounted once at app
 * start). When the bridge receives a project.create_modal request, it
 * calls requestProjectSetup() which flips a reactive open flag and
 * awaits user confirmation or cancel.
 */

import { ref, readonly } from 'vue'

export interface ProjectSetupRequest {
  suggestedName: string
  suggestedDescription: string
}

export type ProjectSetupResult =
  | { path: string; name: string }
  | { cancelled: true }

interface ActiveRequest extends ProjectSetupRequest {
  resolve: (r: ProjectSetupResult) => void
}

const current = ref<ActiveRequest | null>(null)

/**
 * Reactive state the host component reads to know whether to show the
 * modal and what to prefill. Exposed read-only to prevent outside code
 * from mutating the queue directly.
 */
export const activeProjectSetupRequest = readonly(current)

/**
 * Open the New Project modal with prefilled suggestions. Resolves with
 * { path, name } on confirm, { cancelled: true } on cancel.
 *
 * Only one request is active at a time — a second call while another is
 * pending rejects the old one as cancelled and replaces it. In practice
 * the bridge serializes its calls, so this is defensive.
 */
export function requestProjectSetup(
  req: ProjectSetupRequest,
): Promise<ProjectSetupResult> {
  return new Promise((resolve) => {
    if (current.value) {
      current.value.resolve({ cancelled: true })
    }
    current.value = { ...req, resolve }
  })
}

/** Called by the host component when the user clicks Create. */
export function resolveProjectSetup(result: { path: string; name: string }): void {
  const req = current.value
  current.value = null
  req?.resolve(result)
}

/** Called by the host component when the user dismisses the modal. */
export function cancelProjectSetup(): void {
  const req = current.value
  current.value = null
  req?.resolve({ cancelled: true })
}
