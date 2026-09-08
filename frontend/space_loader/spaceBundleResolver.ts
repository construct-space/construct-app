import { getSpaceDirPath } from '@/lib/appPaths'

export interface SpaceBundleDirEntry {
  name: string
  isDirectory?: boolean
  isFile?: boolean
}

export function isSpaceBundleEntry(entry: { name?: string | null; isDirectory?: boolean; isFile?: boolean }): entry is SpaceBundleDirEntry {
  return Boolean(entry.name?.endsWith('.space') && (entry.isDirectory || entry.isFile))
}

export async function resolveSpaceBundleDir(spaceId: string, bundlePath?: string): Promise<string> {
  const candidate = bundlePath || ''
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('space_bundle_resolve', {
      spaceId,
      bundlePath: candidate || null,
    })
  } catch (err) {
    if (candidate) {
      try {
        const { exists } = await import('@tauri-apps/plugin-fs')
        if (await exists(`${candidate}/manifest.json`)) return candidate
      } catch { /* fall through */ }
    }
    throw err
  }
}

export async function resolveInstalledSpaceDir(home: string, spaceId: string): Promise<string> {
  return resolveSpaceBundleDir(spaceId, getSpaceDirPath(home, spaceId))
}

export async function resolveSpaceDirFromBase(spaceId: string, baseDir: string): Promise<string> {
  const { exists } = await import('@tauri-apps/plugin-fs')

  if (baseDir.endsWith('.space')) {
    if (await exists(`${baseDir}/manifest.json`)) return baseDir
    if (await exists(baseDir)) return resolveSpaceBundleDir(spaceId, baseDir)
    return baseDir
  }

  const direct = `${baseDir}/${spaceId}.space`
  if (await exists(`${direct}/manifest.json`)) return direct
  if (await exists(direct)) return resolveSpaceBundleDir(spaceId, direct)

  const dist = `${baseDir}/dist/${spaceId}.space`
  if (await exists(`${dist}/manifest.json`)) return dist
  if (await exists(dist)) return resolveSpaceBundleDir(spaceId, dist)

  return direct
}
