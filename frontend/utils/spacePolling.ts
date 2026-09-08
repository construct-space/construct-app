/**
 * Shared manifest polling helper.
 *
 * Watches a space manifest's `build.builtAt` timestamp and invokes a callback
 * whenever the value changes (i.e. the space was rebuilt).  Returns a stop
 * function so the caller can tear down the poll on unmount.
 *
 * Used by SpaceLoader.watchSpace, SpacePreviewPage, and SpaceRunnerPage.
 */

export async function pollManifestChanges(
  manifestPath: string,
  onChanged: (manifest: Record<string, unknown>) => void | Promise<void>,
  options?: { interval?: number; shouldStop?: () => boolean | Promise<boolean> },
): Promise<() => void> {
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return pollManifestChangesVia(() => readTextFile(manifestPath), onChanged, options)
}

/**
 * Like `pollManifestChanges` but reads the manifest through a caller-supplied
 * function instead of a filesystem path. Lets callers poll a manifest that
 * lives inside a `.space` ZIP (read via IPC) the same way as one on disk.
 */
export async function pollManifestChangesVia(
  readManifest: () => Promise<string>,
  onChanged: (manifest: Record<string, unknown>) => void | Promise<void>,
  options?: { interval?: number; shouldStop?: () => boolean | Promise<boolean> },
): Promise<() => void> {
  const interval = options?.interval ?? 2000
  const shouldStop = options?.shouldStop

  // Read initial builtAt so we only fire on *changes*
  let lastBuiltAt = ''
  try {
    const json = JSON.parse(await readManifest())
    lastBuiltAt = json.build?.builtAt || ''
  } catch {
    /* manifest may not exist yet — that's fine */
  }

  let stopped = false

  const poll = async () => {
    if (stopped) return
    if (shouldStop && await shouldStop()) {
      stopped = true
      return
    }

    try {
      const json = JSON.parse(await readManifest())
      const builtAt: string = json.build?.builtAt || ''
      if (builtAt && builtAt !== lastBuiltAt) {
        lastBuiltAt = builtAt
        await onChanged(json)
      }
    } catch {
      /* file may be mid-write — ignore and retry next tick */
    }

    if (!stopped) setTimeout(poll, interval)
  }

  // First tick after one interval
  setTimeout(poll, interval)

  return () => {
    stopped = true
  }
}
