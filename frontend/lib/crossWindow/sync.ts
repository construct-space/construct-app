import { isTauriEnv } from '@/utils/tauri'

export const channels = {
  auth: 'construct:auth-state',
  profile: 'construct:profile-state',
  project: 'construct:project-state',
  permission: 'construct:permission',
  theme: 'construct:theme',
  sessionDetachReady: 'construct:session-detach-ready',
  sessionDetachRequest: 'construct:session-detach-request',
  sessionReleased: 'construct:session-released',
  stateRequest: 'construct:state-request',
} as const

export function stateSnapshotChannel(requestId: string): string {
  return `construct:state-snapshot-${requestId}`
}

export function sessionChannel(sessionId: string): string {
  return `construct:session-${sessionId}`
}

export type Unlisten = () => void

export async function broadcast(channel: string, payload: unknown): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(channel, payload)
  } catch (err) {
    console.warn('[crossWindow.broadcast] failed:', channel, err)
  }
}

export async function emitTo(targetLabel: string, channel: string, payload: unknown): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const { emitTo: tauriEmitTo } = await import('@tauri-apps/api/event')
    await tauriEmitTo(targetLabel, channel, payload)
  } catch (err) {
    console.warn('[crossWindow.emitTo] failed:', targetLabel, channel, err)
  }
}

export async function listen<T = unknown>(
  channel: string,
  handler: (payload: T) => void,
): Promise<Unlisten> {
  if (!isTauriEnv()) return () => {}
  try {
    const { listen: tauriListen } = await import('@tauri-apps/api/event')
    return await tauriListen<T>(channel, (event) => handler(event.payload))
  } catch (err) {
    console.warn('[crossWindow.listen] failed:', channel, err)
    return () => {}
  }
}
