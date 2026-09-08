import { ref } from 'vue'

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

/** Runtime dev behavior flag — true during `bun run dev` or when --dev flag is passed */
export const IS_DEV_INSTANCE = ref(import.meta.env.DEV === true)

/** Resolved OS-native data directory (set by initAppPaths) */
let resolvedDataDir = ''

/** Call once at app startup to resolve data dir from Rust side */
export async function initAppPaths() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')

    const dataDir = await invoke<string>('get_data_dir')
    if (dataDir) {
      resolvedDataDir = trimTrailingSlash(dataDir)
    } else {
      const { homeDir } = await import('@tauri-apps/api/path')
      const home = trimTrailingSlash(await homeDir())
      resolvedDataDir = `${home}/Library/Application Support/Construct`
    }
  } catch {
    // Not in Tauri
  }
}

/**
 * Returns the app data directory.
 * macOS:   ~/Library/Application Support/Construct
 * Linux:   ~/.local/share/construct
 * Windows: %APPDATA%/Construct
 */
export function getDataDir(home?: string): string {
  if (resolvedDataDir) return resolvedDataDir
  if (home) {
    return `${trimTrailingSlash(home)}/Library/Application Support/Construct`
  }
  return 'Construct'
}

export function getAppDisplayName(): string {
  return 'Construct'
}

export function getAppDeepLinkScheme(): string {
  return 'construct'
}

export const SHOULD_USE_DEV_BEHAVIOR = import.meta.env.DEV

export const APP_DIR_NAME = 'Construct'
export const APP_DISPLAY_NAME = 'Construct'
export const APP_DEEP_LINK_SCHEME = 'construct'

/** @deprecated Use getDataDir() + '/spaces' instead */
export function getAppDirName(): string {
  return 'Construct'
}

export function getSpacesDir(): string {
  if (resolvedDataDir) return `${resolvedDataDir}/spaces`
  return '/Construct/spaces'
}

export function getSpacesDirPath(home: string): string {
  if (resolvedDataDir) return `${resolvedDataDir}/spaces`
  return `${trimTrailingSlash(home)}/Construct/spaces`
}

export function getSpaceBundleDirName(spaceId: string): string {
  const normalized = spaceId.endsWith('.space') ? spaceId.slice(0, -'.space'.length) : spaceId
  return `${normalized}.space`
}

export function getSpaceIdFromDirName(dirName: string): string | null {
  if (!dirName.endsWith('.space')) return null
  const id = dirName.slice(0, -'.space'.length)
  return id || null
}

export function getSpaceDirPath(home: string, spaceId: string): string {
  return `${getSpacesDirPath(home)}/${getSpaceBundleDirName(spaceId)}`
}

export function getSpaceManifestPath(home: string, spaceId: string): string {
  return `${getSpaceDirPath(home, spaceId)}/manifest.json`
}

export function getDeepLinkUrl(action: string, path = ''): string {
  const normalizedPath = path.replace(/^\/+/, '')
  return `construct://${action}${normalizedPath ? `/${normalizedPath}` : ''}`
}
