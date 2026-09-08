import { emit, listen } from '@tauri-apps/api/event'
import { isTauriEnv } from '@/utils/tauri'

const PROFILE_CHANGED_EVENT = 'construct:profile-changed'

export interface ProfileChangedPayload {
  id: string
}

export async function emitProfileChanged(id: string): Promise<void> {
  const nextId = `${id || ''}`.trim()
  if (!nextId || !isTauriEnv()) return

  try {
    await emit(PROFILE_CHANGED_EVENT, { id: nextId } satisfies ProfileChangedPayload)
  } catch {
    // Best effort only; windows still initialize their own profile state on launch.
  }
}

export async function listenProfileChanged(
  handler: (payload: ProfileChangedPayload) => void | Promise<void>,
): Promise<() => void> {
  if (!isTauriEnv()) return () => {}

  return listen<ProfileChangedPayload>(PROFILE_CHANGED_EVENT, (event) => {
    const payload = event.payload ?? { id: '' }
    if (!payload.id) return
    void handler(payload)
  })
}
