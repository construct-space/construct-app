import { ref } from 'vue'

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

/** Compile-time flag (set when building with VITE_CONSTRUCT_DEV_MODE=true) */
const COMPILE_TIME_DEV = import.meta.env.VITE_CONSTRUCT_DEV_MODE === 'true'

/** Runtime dev instance flag — resolves after initAppPaths() */
export const IS_DEV_INSTANCE = ref(COMPILE_TIME_DEV)

/** Resolved OS-native data directory (set by initAppPaths) */
let resolvedDataDir = ''

/** Call once at app startup to detect runtime --dev flag and resolve data dir */
export async function initAppPaths() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')

    if (!COMPILE_TIME_DEV) {
      const isDev = await invoke<boolean>('get_is_dev_instance')
      IS_DEV_INSTANCE.value = isDev
    }

    // Get the data directory from the Rust side (respects --dev flag)
    // This ensures dev instance uses space.construct.personal.dev/
    const dataDir = await invoke<string>('get_data_dir')
    if (dataDir) {
      resolvedDataDir = trimTrailingSlash(dataDir)
    } else {
      // Fallback to Tauri's default appDataDir
      const { appDataDir } = await import('@tauri-apps/api/path')
      resolvedDataDir = trimTrailingSlash(await appDataDir())
    }
  } catch {
    // Not in Tauri — fallback to home-relative path
  }
}

/**
 * Returns the app data directory.
 * In Tauri: ~/Library/Application Support/Construct/ (macOS)
 * Fallback: $HOME/.construct/
 */
export function getDataDir(home?: string): string {
  if (resolvedDataDir) return resolvedDataDir
  // Fallback for non-Tauri contexts
  const dirName = IS_DEV_INSTANCE.value ? '.construct-dev' : '.construct'
  return home ? `${trimTrailingSlash(home)}/${dirName}` : dirName
}

export function getAppDisplayName(): string {
  return IS_DEV_INSTANCE.value ? 'Construct DEV' : 'Construct'
}

export function getAppDeepLinkScheme(): string {
  return IS_DEV_INSTANCE.value ? 'construct-dev' : 'construct'
}

export const SHOULD_USE_DEV_BEHAVIOR = import.meta.env.DEV || COMPILE_TIME_DEV

// Backward-compat constants (compile-time only)
export const APP_DIR_NAME = COMPILE_TIME_DEV ? '.construct-dev' : '.construct'
export const APP_DISPLAY_NAME = COMPILE_TIME_DEV ? 'Construct DEV' : 'Construct'
export const APP_DEEP_LINK_SCHEME = COMPILE_TIME_DEV ? 'construct-dev' : 'construct'

/** @deprecated Use getDataDir() + '/spaces' instead */
export function getAppDirName(): string {
  return IS_DEV_INSTANCE.value ? '.construct-dev' : '.construct'
}

export function getSpacesDir(): string {
  if (resolvedDataDir) return `${resolvedDataDir}/spaces`
  return `/${getAppDirName()}/spaces`
}

export function getSpacesDirPath(home: string): string {
  if (resolvedDataDir) return `${resolvedDataDir}/spaces`
  return `${trimTrailingSlash(home)}/${getAppDirName()}/spaces`
}

export function getSpaceDirPath(home: string, spaceId: string): string {
  return `${getSpacesDirPath(home)}/${spaceId}`
}

export function getSpaceManifestPath(home: string, spaceId: string): string {
  return `${getSpaceDirPath(home, spaceId)}/manifest.json`
}

export function getDeepLinkUrl(action: string, path = ''): string {
  const normalizedPath = path.replace(/^\/+/, '')
  return `${getAppDeepLinkScheme()}://${action}${normalizedPath ? `/${normalizedPath}` : ''}`
}
