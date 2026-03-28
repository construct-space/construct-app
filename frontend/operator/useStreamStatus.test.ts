import { describe, expect, it } from 'vitest'
import { useStreamStatus } from './useStreamStatus'

describe('useStreamStatus', () => {
  it('keeps tool status titles out of narration progress', () => {
    const streamStatus = useStreamStatus()

    streamStatus.handleChunk({
      type: 'status',
      content: '',
      done: false,
      data: {
        state: 'tool_running',
        message: 'Creating directories',
        tool: 'bash',
        call_id: 'call-1',
      },
    })

    expect(streamStatus.status.value.message).toBe('Creating directories')
    expect(streamStatus.statusNarration.value).toBe('')
    expect(streamStatus.progressUpdates.value).toEqual([])
  })

  it('keeps non-tool status messages in narration progress', () => {
    const streamStatus = useStreamStatus()

    streamStatus.handleChunk({
      type: 'status',
      content: '',
      done: false,
      data: {
        state: 'thinking',
        message: 'Reviewing the existing project structure',
      },
    })

    expect(streamStatus.statusNarration.value).toBe('Reviewing the existing project structure')
    expect(streamStatus.progressUpdates.value).toHaveLength(1)
    expect(streamStatus.progressUpdates.value[0]?.headline).toBe('Reviewing the existing project structure')
  })
})
