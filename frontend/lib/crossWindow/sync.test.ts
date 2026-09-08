import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  channels,
  stateSnapshotChannel,
  sessionChannel,
  broadcast,
  emitTo,
  listen,
} from './sync'

const tauriEnvMock = vi.hoisted(() => ({ isTauriEnv: vi.fn(() => true) }))
vi.mock('@/utils/tauri', () => tauriEnvMock)

const tauriEventMock = vi.hoisted(() => ({
  emit: vi.fn(async () => {}),
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (_c: string, _h: unknown) => () => {}),
}))
vi.mock('@tauri-apps/api/event', () => tauriEventMock)

describe('crossWindow/sync', () => {
  beforeEach(() => {
    tauriEventMock.emit.mockClear()
    tauriEventMock.emitTo.mockClear()
    tauriEventMock.listen.mockClear()
    tauriEnvMock.isTauriEnv.mockReturnValue(true)
  })

  it('channel constants are unique', () => {
    const values = Object.values(channels)
    expect(new Set(values).size).toBe(values.length)
  })

  it('stateSnapshotChannel interpolates the requestId', () => {
    expect(stateSnapshotChannel('abc')).toBe('construct:state-snapshot-abc')
  })

  it('sessionChannel interpolates the sessionId', () => {
    expect(sessionChannel('sess_1')).toBe('construct:session-sess_1')
  })

  it('broadcast calls tauri emit when in Tauri', async () => {
    await broadcast(channels.auth, { token: 't' })
    expect(tauriEventMock.emit).toHaveBeenCalledWith(channels.auth, { token: 't' })
  })

  it('broadcast is a no-op outside Tauri', async () => {
    tauriEnvMock.isTauriEnv.mockReturnValue(false)
    await broadcast(channels.auth, { token: 't' })
    expect(tauriEventMock.emit).not.toHaveBeenCalled()
  })

  it('emitTo forwards to a specific window label', async () => {
    await emitTo('detach-assistant-abc', channels.theme, 'dark')
    expect(tauriEventMock.emitTo).toHaveBeenCalledWith('detach-assistant-abc', channels.theme, 'dark')
  })

  it('listen registers a handler and returns an unlisten function', async () => {
    const unlisten = await listen(channels.theme, () => {})
    expect(tauriEventMock.listen).toHaveBeenCalled()
    expect(typeof unlisten).toBe('function')
  })

  it('listen returns a noop unlisten outside Tauri', async () => {
    tauriEnvMock.isTauriEnv.mockReturnValue(false)
    const unlisten = await listen(channels.theme, () => {})
    expect(tauriEventMock.listen).not.toHaveBeenCalled()
    expect(typeof unlisten).toBe('function')
    unlisten()
  })
})
