export interface SpaceToolRunOptions {
  stdin?: string
  cwd?: string
  timeoutMs?: number
}

export interface SpaceToolResult {
  stdout: string
  stderr: string
  code: number
  timedOut: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export interface SpaceToolHandle {
  name: string
  spaceId: string
  invoke(args?: string[], opts?: SpaceToolRunOptions): Promise<SpaceToolResult>
  run(args?: string[], opts?: SpaceToolRunOptions): Promise<SpaceToolResult>
  resolve(): Promise<string>
}

export interface UseSpaceToolOptions {
  spaceId?: string
}

function currentSpaceId(explicit?: string): string {
  const id = explicit || window.construct?.space?.id || ''
  if (!id) throw new Error('useSpaceTool requires an active space id')
  return id
}

function normalizeOpts(opts?: SpaceToolRunOptions) {
  if (!opts) return undefined
  return {
    stdin: opts.stdin,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
  }
}

/**
 * Invoke a first-party CLI shipped in `<space-id>.space/tools/<platform>/`.
 *
 * Construct sets SPACE_DIR, SPACE_TOOLS, SPACE_LIB, SPACE_LIB_ROOT,
 * CONSTRUCT_SPACE_ID, CONSTRUCT_PLATFORM, and PATH with the selected
 * `lib/<platform>` and `tools/<platform>` dirs first.
 */
export function useSpaceTool(name: string, options: UseSpaceToolOptions = {}): SpaceToolHandle {
  if (!name) throw new Error('useSpaceTool requires a tool name')
  const spaceId = currentSpaceId(options.spaceId)

  const invokeTool = async (args: string[] = [], opts?: SpaceToolRunOptions): Promise<SpaceToolResult> => {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<SpaceToolResult>('space_tool_invoke', {
      spaceId,
      name,
      args,
      opts: normalizeOpts(opts),
    })
  }

  return {
    name,
    spaceId,
    invoke: invokeTool,
    run: invokeTool,
    async resolve() {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<string>('space_tool_resolve', { spaceId, name })
    },
  }
}
