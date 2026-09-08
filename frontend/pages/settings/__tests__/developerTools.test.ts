import { describe, expect, it } from 'vitest'

import { detectConstructCli } from '../developerTools'

describe('detectConstructCli', () => {
  it('detects CLI via construct --version when the binary is present', async () => {
    const calls: Array<{ command: string; args: string[] }> = []

    const result = await detectConstructCli(async (command, args) => {
      calls.push({ command, args })
      if (command === 'construct' && args[0] === '--version') {
        return {
          success: true,
          stdout: '1.0.7\n',
          stderr: '',
        }
      }
      return {
        success: false,
        stdout: '',
        stderr: 'unknown command',
      }
    })

    expect(result).toEqual({
      installed: true,
      version: '1.0.7',
    })
    expect(calls[0]).toEqual({
      command: 'construct',
      args: ['--version'],
    })
  })

  it('only probes the construct binary without a shell fallback', async () => {
    const calls: Array<{ command: string; args: string[] }> = []

    await detectConstructCli(async (command, args) => {
      calls.push({ command, args })
      return {
        success: false,
        stdout: '',
        stderr: 'not found',
      }
    })

    expect(calls).toEqual([{ command: 'construct', args: ['--version'] }])
  })
})
