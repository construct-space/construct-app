import { computed, ref } from 'vue'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'

/**
 * Developer settings — persisted to developer.json in data dir.
 * Not synced to remote API. Local-only.
 */

interface DeveloperConfig {
  enabled: boolean
  disableUpdates: boolean
}

// Module-level reactive state
const developerMode = ref(false)
const disableUpdates = ref(false)
let _initialized = false

async function loadConfig(): Promise<DeveloperConfig | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
    const path = `${dataDir}/developer.json`
    if (await exists(path)) {
      return JSON.parse(await readTextFile(path))
    }
  } catch { /* not in Tauri or file doesn't exist */ }
  return null
}

async function saveConfig() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
    if (!await exists(dataDir)) {
      await mkdir(dataDir, { recursive: true })
    }
    const config: DeveloperConfig = {
      enabled: developerMode.value,
      disableUpdates: disableUpdates.value,
    }
    await writeTextFile(`${dataDir}/developer.json`, JSON.stringify(config, null, 2))
  } catch { /* best-effort */ }
}

async function init() {
  if (_initialized) return
  _initialized = true
  const config = await loadConfig()
  if (config) {
    developerMode.value = config.enabled
    disableUpdates.value = config.disableUpdates
  }
}

export function useDevMode() {
  // Trigger async init on first use
  init()

  const isDevInstance = IS_DEV_INSTANCE
  const isDeveloperMode = computed(() => developerMode.value || IS_DEV_INSTANCE.value)
  const updaterDisabled = computed(() => IS_DEV_INSTANCE.value || import.meta.env.DEV || disableUpdates.value)

  /** Toggle developer mode and persist */
  function setDeveloperMode(val: boolean) {
    console.log('[DevMode] setDeveloperMode:', val)
    developerMode.value = val
    saveConfig()
  }

  /** Toggle disable updates and persist */
  function setDisableUpdates(val: boolean) {
    disableUpdates.value = val
    saveConfig()
  }

  return {
    isDevInstance,
    developerMode,
    isDeveloperMode,
    disableUpdates,
    updaterDisabled,
    setDeveloperMode,
    setDisableUpdates,
  }
}
