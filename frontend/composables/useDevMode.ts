import { computed, ref } from 'vue'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'

/**
 * Developer mode — gated by server-side enrollment.
 *
 * Users must enroll as developers via their Construct account.
 * developer_status: 'none' | 'pending' | 'enrolled' | 'rejected' | 'suspended'
 *
 * Only 'enrolled' users can access developer features.
 * Local developer.json config is for additional local preferences (disableUpdates).
 * Dev instances (IS_DEV_INSTANCE) bypass enrollment check.
 */

interface DeveloperConfig {
  disableUpdates: boolean
}

// Module-level reactive state
const developerStatus = ref<string>('none')
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
      disableUpdates: disableUpdates.value,
    }
    await writeTextFile(`${dataDir}/developer.json`, JSON.stringify(config, null, 2))
  } catch { /* best-effort */ }
}

async function init() {
  if (_initialized) return
  _initialized = true

  // Load local config
  const config = await loadConfig()
  if (config) {
    disableUpdates.value = config.disableUpdates
  }

  // Load developer status from auth store
  try {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    if (authStore.user?.developer_status) {
      developerStatus.value = authStore.user.developer_status
    }
  } catch { /* auth store not ready */ }
}

export function useDevMode() {
  init()

  const isDevInstance = IS_DEV_INSTANCE

  // Developer mode: enrolled on server OR running dev instance
  const isDeveloperMode = computed(() =>
    developerStatus.value === 'enrolled' || IS_DEV_INSTANCE.value
  )

  const isEnrollmentPending = computed(() => developerStatus.value === 'pending')
  const isEnrolled = computed(() => developerStatus.value === 'enrolled')
  const updaterDisabled = computed(() => IS_DEV_INSTANCE.value || import.meta.env.DEV || disableUpdates.value)

  /** Request developer enrollment */
  async function requestEnrollment(): Promise<{ status: string; message: string }> {
    try {
      const { useConstructAuth } = await import('@/composables/useConstructAuth')
      const { useAuthStore } = await import('@/stores/auth')
      const auth = useConstructAuth()
      const authStore = useAuthStore()
      const token = authStore.oauthToken || authStore.token
      if (!token) return { status: 'error', message: 'Not authenticated' }

      const response = await fetch(`${auth.accountsUrl}/api/developer/enroll`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.status) {
        developerStatus.value = data.status
        // Update local user data
        if (authStore.user) {
          authStore.user.developer_status = data.status
          authStore.persistAuthState()
        }
      }
      return data
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : 'Failed to enroll' }
    }
  }

  /** Refresh developer status from server */
  async function refreshStatus() {
    try {
      const { useConstructAuth } = await import('@/composables/useConstructAuth')
      const { useAuthStore } = await import('@/stores/auth')
      const auth = useConstructAuth()
      const authStore = useAuthStore()
      const token = authStore.oauthToken || authStore.token
      if (!token) return

      const response = await fetch(`${auth.accountsUrl}/api/developer/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.status) {
        developerStatus.value = data.status
        if (authStore.user) {
          authStore.user.developer_status = data.status
          authStore.persistAuthState()
        }
      }
    } catch { /* best-effort */ }
  }

  function setDisableUpdates(val: boolean) {
    disableUpdates.value = val
    saveConfig()
  }

  return {
    isDevInstance,
    developerStatus,
    isDeveloperMode,
    isEnrollmentPending,
    isEnrolled,
    disableUpdates,
    updaterDisabled,
    requestEnrollment,
    refreshStatus,
    setDisableUpdates,
  }
}
