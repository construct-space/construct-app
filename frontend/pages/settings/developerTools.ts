export interface ShellCommandResult {
  success: boolean
  stdout: string
  stderr: string
}

export type ShellCommandFn = (
  command: string,
  args: string[],
) => Promise<ShellCommandResult>

function parseCliVersion(output: string): string {
  return output.trim().split('\n').pop()?.trim() || ''
}

export async function detectConstructCli(
  run: ShellCommandFn,
): Promise<{ installed: boolean; version: string }> {
  const candidates = [
    { command: 'construct', args: ['--version'] },
  ]

  for (const candidate of candidates) {
    try {
      const result = await run(candidate.command, candidate.args)
      const version = parseCliVersion(result.stdout)
      if (result.success && version) {
        return { installed: true, version }
      }
    } catch {
      // Try the next candidate.
    }
  }

  return { installed: false, version: '' }
}
